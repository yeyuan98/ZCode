// 闲时任务（off-peak）scheduler 侧控制器：P3 本地准入的核心。
// 从 schedulerRuntime 抽出的独立闭包工厂——退避表/在途集合/准入等待表都是
// 每 runtime 实例状态，不落模块级（测试并发驱动多个 runtime 时互不串扰）。
// 职责：
//   - 每 tick 先向 main 发 correlated 准入询问（withinWindow 求值属主在 main），
//     通过后才认领 queued 任务派发；Run-now 消息绕过窗口强制认领单个任务。
//   - 派发结果结算复用 offPeakDispatchSettlement（成功 markRunning / 失败退避或转 failed）。
import type { OffPeakTaskRepo } from "@zcode/services/node";
import type { ZCodeOffPeakTask } from "@zcode/shared";
import type { MainToSchedulerMessage, SchedulerToMainMessage } from "./schedulerProtocol.js";
import { settleOffPeakDispatchResult } from "./offPeakDispatchSettlement.js";

/** 准入询问等待上限：main 无响应按拒绝处理（fail-closed），下轮 tick 再问。 */
const ADMISSION_TIMEOUT_MS = 5_000;

export interface OffPeakSchedulerController {
  /** P3 本地准入：认领前询问；拒绝（窗口关/超时/端口异常）时本轮不认领。 */
  requestAdmission(): Promise<boolean>;
  /** 认领并派发单个到期任务（准入已通过的批量路径）。 */
  claimAndDispatchDue(now: number): Promise<void>;
  /** Run-now 强制派发：绕过窗口认领单个任务；claim 原子保证幂等 no-op。 */
  runNow(offPeakTaskId: string): Promise<void>;
  /** 结算 main 回报的派发结果（迟到结果凭 offPeakTaskId 幂等结算）。 */
  settleDispatchResult(
    msg: Extract<MainToSchedulerMessage, { type: "offpeak-dispatch-result" }>,
  ): Promise<void>;
  /** offpeak-admission-response 的关联应答回调；未知 requestId 静默丢弃。 */
  handleAdmissionResponse(requestId: string, allowed: boolean): void;
  /** keep-awake 计数上报：值变化才发消息。 */
  reportActiveCount(): Promise<void>;
  /** 退出路径：释放本进程仍在途的认领（尽力而为）。 */
  releaseInFlight(): Promise<void>;
  /** 退出路径：立即拒绝所有未应答的准入等待（避免悬挂 promise）。 */
  settleAdmissionWaiters(): void;
}

// 仅模块内使用的依赖形状，不导出（外部消费方经 createOffPeakSchedulerController 参数推导）。
interface OffPeakSchedulerControllerDeps {
  port: Pick<SchedulerPortShape, "postMessage">;
  repo: OffPeakTaskRepo;
  log: (level: "info" | "warn" | "error", message: string) => void;
  now: () => number;
}

/** schedulerRuntime 的端口面在此处只需要 postMessage（收包仍由 runtime 分发）。 */
interface SchedulerPortShape {
  postMessage(message: SchedulerToMainMessage): void;
}

export function createOffPeakSchedulerController(
  deps: OffPeakSchedulerControllerDeps,
): OffPeakSchedulerController {
  const { port, repo, log, now } = deps;
  /** 进程内退避表：offPeakTaskId → 下次允许派发时间/已失败次数。scheduler 重启即重置，无害。 */
  const retryAt = new Map<string, number>();
  const retryAttempts = new Map<string, number>();
  /** 在途派发集合：仅用于退出时释放认领；迟到结果凭 offPeakTaskId 即可结算，不依赖它。 */
  const inFlight = new Set<string>();
  /** 准入询问的关联应答等待表：requestId → resolver。 */
  const admissionWaiters = new Map<
    string,
    { resolve: (allowed: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();
  let admissionSeq = 0;
  let lastActiveCount = -1;

  function requestAdmission(): Promise<boolean> {
    admissionSeq += 1;
    const requestId = `admission:${admissionSeq}`;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        admissionWaiters.delete(requestId);
        log("warn", `off-peak admission response timeout requestId=${requestId}`);
        resolve(false);
      }, ADMISSION_TIMEOUT_MS);
      timer.unref?.();
      admissionWaiters.set(requestId, {
        resolve: (allowed) => {
          clearTimeout(timer);
          resolve(allowed);
        },
        timer,
      });
      try {
        port.postMessage({ type: "offpeak-admission-request", requestId });
      } catch (error) {
        admissionWaiters.delete(requestId);
        clearTimeout(timer);
        log(
          "warn",
          `off-peak admission request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        resolve(false);
      }
    });
  }

  function handleAdmissionResponse(requestId: string, allowed: boolean): void {
    const waiter = admissionWaiters.get(requestId);
    if (!waiter) return;
    admissionWaiters.delete(requestId);
    waiter.resolve(allowed);
  }

  function settleAdmissionWaiters(): void {
    for (const { resolve, timer } of admissionWaiters.values()) {
      clearTimeout(timer);
      resolve(false);
    }
    admissionWaiters.clear();
  }

  /**
   * 认领后派发闲时任务。退避中的任务立即释放认领等下轮（进程内退避表；每轮 claim+release
   * 两次写，任务数小、WAL 下开销可忽略——若退避任务成规模再把退避下沉进 claimDue）。
   */
  async function dispatchClaimed(task: ZCodeOffPeakTask, atTime: number): Promise<void> {
    const taskRetryAt = retryAt.get(task.offPeakTaskId) ?? 0;
    if (taskRetryAt > atTime) {
      await repo.releaseClaim(task.offPeakTaskId, { now: atTime });
      return;
    }
    inFlight.add(task.offPeakTaskId);
    const request: SchedulerToMainMessage = {
      type: "offpeak-dispatch-request",
      offPeakTaskId: task.offPeakTaskId,
      prompt: task.prompt,
      permissionMode: task.permissionMode,
      modelSelection: task.modelSelection,
      ...(task.conversationId ? { conversationId: task.conversationId } : {}),
      ...(task.sessionId ? { sessionId: task.sessionId } : {}),
      workspacePath: task.workspacePath,
      ...(task.workspaceIdentity ? { workspaceIdentity: task.workspaceIdentity } : {}),
    };
    port.postMessage(request);
    log("info", `off-peak dispatch requested task=${task.offPeakTaskId}`);
  }

  async function claimAndDispatchDue(atTime: number): Promise<void> {
    const claimed = await repo.claimDue(atTime);
    for (const task of claimed) {
      await dispatchClaimed(task, atTime);
    }
  }

  async function runNow(offPeakTaskId: string): Promise<void> {
    const claimed = await repo.claimOneForRunNow(offPeakTaskId, now());
    if (!claimed) {
      log("info", `off-peak run-now no-op (not claimable) task=${offPeakTaskId}`);
      return;
    }
    log("info", `off-peak run-now dispatch task=${offPeakTaskId}`);
    await dispatchClaimed(claimed, now());
  }

  async function settleDispatchResult(
    msg: Extract<MainToSchedulerMessage, { type: "offpeak-dispatch-result" }>,
  ): Promise<void> {
    inFlight.delete(msg.offPeakTaskId);
    await settleOffPeakDispatchResult({ repo, retryAt, retryAttempts, now, log }, msg);
  }

  async function reportActiveCount(): Promise<void> {
    try {
      const count = await repo.countActive();
      if (count === lastActiveCount) return;
      lastActiveCount = count;
      port.postMessage({ type: "offpeak-active-count", count });
    } catch (error) {
      log(
        "warn",
        `off-peak active count report failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function releaseInFlight(): Promise<void> {
    for (const offPeakTaskId of inFlight) {
      try {
        await repo.releaseClaim(offPeakTaskId);
      } catch {
        // 忽略：退出路径尽力而为。
      }
    }
    inFlight.clear();
  }

  return {
    requestAdmission,
    claimAndDispatchDue,
    runNow,
    settleDispatchResult,
    handleAdmissionResponse,
    reportActiveCount,
    releaseInFlight,
    settleAdmissionWaiters,
  };
}
