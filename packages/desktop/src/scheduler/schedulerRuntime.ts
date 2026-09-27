// 常驻 cron scheduler 进程 runtime（端口注入 seam）：
// 职责（tasks-index 属主方案）：
//   - 轮询 tasks-index 的 automations（cronSchedulerController：misfire/台账/退避/结算）
//   - 闲时任务（offPeakSchedulerController）：启动回收中断任务；每 tick 先 correlated
//     准入询问（P3 本地准入，窗口求值属主在 main），通过后才认领派发；Run-now 消息
//     绕过窗口强制认领单个任务。与 automation 表/消息/常量全部独立，⚠ 无 misfire-skip 语义。
// 本进程只读写 tasks-index，不碰 UI / agent runtime；createTask 由 host 域执行。
// 入口装配在 index.ts（Electron parentPort）；node:test 用端口 shim 直接驱动本 runtime。
import { AutomationRepo, OffPeakTaskRepo } from "@zcode/services/node";
import type { MainToSchedulerMessage, SchedulerToMainMessage } from "./schedulerProtocol.js";
import {
  createCronSchedulerController,
  type CronSchedulerController,
} from "./cronSchedulerController.js";
import {
  createOffPeakSchedulerController,
  type OffPeakSchedulerController,
} from "./offPeakSchedulerController.js";

/** 轮询间隔：cron 最小粒度是分钟，20s 轮询足以按时命中且开销低。 */
const POLL_INTERVAL_MS = 20_000;

/** runtime 与宿主进程之间的最小端口面（Electron parentPort / node:test shim 共用）。 */
export interface SchedulerPort {
  postMessage(message: SchedulerToMainMessage): void;
  onMessage(listener: (message: MainToSchedulerMessage) => void): void;
}

export interface SchedulerRuntimeHandle {
  /** 立即触发一次 tick（外部唤醒/测试驱动）。 */
  requestTick(): void;
  /** 优雅收尾：释放认领、关库；exitOnDispose=false 时（测试）不退出进程。 */
  dispose(): Promise<void>;
}

export interface SchedulerRuntimeDeps {
  port: SchedulerPort;
  automationRepo: AutomationRepo;
  offPeakRepo: OffPeakTaskRepo;
  now?: () => number;
  pollIntervalMs?: number;
  /** 测试注入时为 false，避免 node:test 进程被退出。 */
  exitOnDispose?: boolean;
}

export function createSchedulerRuntime(deps: SchedulerRuntimeDeps): SchedulerRuntimeHandle {
  const { port, automationRepo: repo, offPeakRepo } = deps;
  const now = deps.now ?? Date.now;
  const pollIntervalMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
  const exitOnDispose = deps.exitOnDispose ?? true;

  const log = (level: "info" | "warn" | "error", message: string): void => {
    try {
      port.postMessage({ type: "scheduler-log", level, message });
    } catch {
      // 端口关闭（退出路径）时丢弃日志即可。
    }
  };

  const cron: CronSchedulerController = createCronSchedulerController({
    repo,
    postMessage: port.postMessage.bind(port),
    log,
    now,
  });
  const offPeak: OffPeakSchedulerController = createOffPeakSchedulerController({
    port,
    repo: offPeakRepo,
    log,
    now,
  });

  let ticking = false;
  let tickRequested = false;
  let schedulerReady = false;
  let disposed = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<void> {
    if (disposed || !schedulerReady || ticking) return;
    ticking = true;
    try {
      do {
        tickRequested = false;
        try {
          const atTime = now();
          await cron.claimAndDispatchDue(atTime);
          await cron.claimAndDispatchManualRuns(atTime);
          // P3 本地准入：认领前先问 main（窗口求值属主）；拒绝则本轮跳过闲时认领。
          if (await offPeak.requestAdmission()) {
            await offPeak.claimAndDispatchDue(atTime);
          }
          // keep-awake：上报执行中计数，main 据此 + 设置决定 powerSaveBlocker。
          await offPeak.reportActiveCount();
        } catch (error) {
          log("error", `tick failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        // manual run 的唤醒可能与当前 tick 重叠；因 ticking=true 直接丢弃会让
        // 用户仍需等待下一轮 20 秒轮询。记录 pending，并在本轮完成后立即补跑。
      } while (tickRequested && !disposed);
    } finally {
      ticking = false;
    }
  }

  function requestTick(): void {
    if (disposed) return;
    if (!schedulerReady || ticking) {
      tickRequested = true;
      return;
    }
    void tick();
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    offPeak.settleAdmissionWaiters();
    // 释放本进程仍在途的认领，避免下次启动等到 CLAIM_STALE 才回收。
    await cron.releaseInFlight();
    await offPeak.releaseInFlight();
    try {
      repo.close();
    } catch {
      // 忽略。
    }
    try {
      offPeakRepo.close();
    } catch {
      // 忽略。
    }
    if (exitOnDispose) process.exit(0);
  }

  port.onMessage((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "scheduler-dispose") {
      void dispose();
      return;
    }
    if (msg.type === "cron-dispatch-result") {
      void cron
        .settleDispatchResult(msg)
        .then(() => {
          // manual run 可能因同一 automation 已有派发在途而暂时无法认领。
          // 前一轮结算释放 single-flight 锁后主动 tick，避免再次等待 20 秒轮询。
          requestTick();
        })
        .catch((error) => {
          log(
            "error",
            `settle dispatch result failed runId=${msg.runId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      return;
    }
    if (msg.type === "offpeak-dispatch-result") {
      void offPeak.settleDispatchResult(msg).catch((error) => {
        log(
          "error",
          `settle off-peak dispatch result failed task=${msg.offPeakTaskId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      return;
    }
    if (msg.type === "scheduler-wake") {
      log("info", `manual run wake requested automation=${msg.automationId}`);
      requestTick();
      return;
    }
    if (msg.type === "offpeak-admission-response") {
      offPeak.handleAdmissionResponse(msg.requestId, msg.allowed);
      return;
    }
    if (msg.type === "offpeak-run-now") {
      void offPeak.runNow(msg.offPeakTaskId).catch((error) => {
        log(
          "error",
          `off-peak run-now failed task=${msg.offPeakTaskId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      return;
    }
  });

  void (async () => {
    await repo.ensureReady();
    // 闲时任务中断恢复：scheduler 是 app 单例、先于任何派发启动——此刻 DB 里的
    // running 必属上一个 app 实例残留，安全置回 queued（session 保留供 resume 续跑）。
    try {
      const recovered = await offPeakRepo.recoverInterrupted(now());
      if (recovered > 0) {
        log("info", `off-peak recovered ${recovered} interrupted task(s) back to queued`);
      }
    } catch (error) {
      log(
        "error",
        `off-peak recoverInterrupted failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    schedulerReady = true;
    log("info", "cron scheduler started");
    requestTick();
    pollTimer = setInterval(requestTick, pollIntervalMs);
    // 与 services 侧定时器同一约定：不阻止进程退出（utility process 生命周期由宿主管）。
    pollTimer.unref?.();
  })().catch((error) => {
    log(
      "error",
      `scheduler bootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (exitOnDispose) process.exit(1);
  });

  return { requestTick, dispose };
}
