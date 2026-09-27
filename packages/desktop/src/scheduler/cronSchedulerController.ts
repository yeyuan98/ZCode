// cron automation scheduler 侧控制器：从 schedulerRuntime 抽出的独立闭包工厂。
// 职责：到期认领后的 misfire 判定、run 台账、派发请求与 main 回报结算；
// 与闲时任务（offPeakSchedulerController）表/消息/常量全部独立，禁止互相复用。
import {
  AutomationRepo,
  computeAutomationNextRunAt,
  isOneShotAutomation,
} from "@zcode/services/node";
import {
  resolveWorkspaceKey,
  type ZCodeAutomation,
  type ZCodeAutomationTrigger,
  type ZCodeAutomationRun,
} from "@zcode/shared";
import type { MainToSchedulerMessage, SchedulerToMainMessage } from "./schedulerProtocol.js";
import { settleManualClaimForDispatchResult } from "./manualClaimRelease.js";

/**
 * misfire 宽限：next_run_at 早于 now 超过该值，视为「关机/休眠/退出期间错过的窗口」→ 记 skipped 不补跑。
 * 取值需明显大于一次正常轮询延迟（避免把正常到点误判成 misfire），又能覆盖短暂卡顿。
 */
const MISFIRE_GRACE_MS = 5 * 60_000;

type InFlight = {
  automationId: string;
  workspaceKey: string;
  trigger: ZCodeAutomationTrigger;
};

export interface CronSchedulerController {
  /** 认领并派发所有到期 cron 任务（含 misfire 跳过与 run 台账）。 */
  claimAndDispatchDue(now: number): Promise<void>;
  /** 认领并派发 manual run（手动触发不改排程事实）。 */
  claimAndDispatchManualRuns(now: number): Promise<void>;
  /** 结算 main 回报的 cron/manual 派发结果。 */
  settleDispatchResult(
    msg: Extract<MainToSchedulerMessage, { type: "cron-dispatch-result" }>,
  ): Promise<void>;
  /** 退出路径：释放本进程仍在途的 cron/manual 认领（尽力而为）。 */
  releaseInFlight(): Promise<void>;
}

// 仅模块内使用的依赖形状，不导出（外部消费方经 createCronSchedulerController 参数推导）。
interface CronSchedulerControllerDeps {
  repo: AutomationRepo;
  postMessage: (message: SchedulerToMainMessage) => void;
  log: (level: "info" | "warn" | "error", message: string) => void;
  now: () => number;
}

export function createCronSchedulerController(
  deps: CronSchedulerControllerDeps,
): CronSchedulerController {
  const { repo, postMessage, log, now } = deps;
  /** runId → 在途派发上下文；等 main 回报后结算。scheduler 重启丢失时靠 claimDue 的僵尸回收兜底。 */
  const inFlight = new Map<string, InFlight>();

  /** 派发时间戳：优先用 next_run_at（重试期间不变，保证 runId 稳定），退到 retry_at / now。 */
  function resolveScheduledAt(automation: ZCodeAutomation, atTime: number): number {
    return automation.nextRunAt ?? automation.retryAt ?? atTime;
  }

  function buildRunId(automationId: string, scheduledAt: number): string {
    return `${automationId}:${scheduledAt}`;
  }

  function postDispatchRequest(
    automation: ZCodeAutomation,
    runId: string,
    fixedSelection?: ZCodeAutomationRun["modelSelection"],
  ): void {
    const request: SchedulerToMainMessage = {
      type: "cron-dispatch-request",
      automationId: automation.automationId,
      runId,
      prompt: automation.prompt,
      ...(automation.targetTaskId ? { targetTaskId: automation.targetTaskId } : {}),
      ...((fixedSelection ?? automation.modelSelection)
        ? { modelSelection: fixedSelection ?? automation.modelSelection }
        : {}),
      ...(automation.mode ? { mode: automation.mode } : {}),
      workspacePath: automation.workspacePath,
      ...(automation.workspaceIdentity ? { workspaceIdentity: automation.workspaceIdentity } : {}),
    };
    postMessage(request);
  }

  async function handleClaimed(automation: ZCodeAutomation, atTime: number): Promise<void> {
    const scheduledAt = resolveScheduledAt(automation, atTime);
    const runId = buildRunId(automation.automationId, scheduledAt);
    const workspaceKey = resolveWorkspaceKey({
      workspacePath: automation.workspacePath,
      workspaceIdentity: automation.workspaceIdentity,
    });
    const isRetry = automation.dispatchAttempts > 0;

    // misfire：首轮（非重试）且计划触发时间已远早于 now → 认定错过窗口，跳过不补跑。
    const missed =
      !isRetry && automation.nextRunAt != null && automation.nextRunAt <= atTime - MISFIRE_GRACE_MS;
    if (missed) {
      // 纯一次性任务（如 delayMinutes 落成的 minute scheduleRule）错过窗口后，
      // 通用重算会给出 anchorAt + k*interval 的下一周期，让“只跑一次”的提醒在后续周期
      // 继续执行。一次性语义是确定的目标时刻，错过即终态，不得再排程新的执行承诺。
      const finalize = isOneShotAutomation(automation);
      const nextRunAt = finalize ? null : computeAutomationNextRunAt(automation, atTime);
      await repo.skipAndReschedule({
        automationId: automation.automationId,
        runId,
        workspaceKey,
        scheduledAt,
        reason: "computer_asleep_or_app_not_running",
        nextRunAt,
        finalize,
      });
      log(
        "info",
        `skip missed window automation=${automation.automationId} scheduledAt=${scheduledAt}${finalize ? " finalized=one-shot" : ""}`,
      );
      return;
    }

    // 正常派发：先落/更新 run 台账（claimed），再把请求发回 main。
    await repo.upsertRunClaimed({
      runId,
      automationId: automation.automationId,
      workspaceKey,
      scheduledAt,
      trigger: "schedule",
      // 原意图在 dispatch request 中传递，首次有效选择由目标 Host 固定；此处不提前冻结。
    });
    inFlight.set(runId, {
      automationId: automation.automationId,
      workspaceKey,
      trigger: "schedule",
    });
    const run = await repo.getRun(runId);
    postDispatchRequest(automation, runId, run?.modelSelection);
  }

  async function handleClaimedManual(
    automation: ZCodeAutomation,
    run: ZCodeAutomationRun,
  ): Promise<void> {
    inFlight.set(run.runId, {
      automationId: automation.automationId,
      workspaceKey: resolveWorkspaceKey({
        workspacePath: automation.workspacePath,
        workspaceIdentity: automation.workspaceIdentity,
      }),
      trigger: "manual",
    });
    postDispatchRequest(automation, run.runId, run.modelSelection);
  }

  async function settleDispatchResult(
    msg: Extract<MainToSchedulerMessage, { type: "cron-dispatch-result" }>,
  ): Promise<void> {
    const context = inFlight.get(msg.runId);
    inFlight.delete(msg.runId);
    const atTime = now();
    // 从 runId 还原 automationId（context 丢失时兜底，如 scheduler 重启后收到迟到回报）。
    const automationId = context?.automationId ?? msg.runId.split(":")[0]!;
    const workspaceKey = context?.workspaceKey;
    const trigger: ZCodeAutomationTrigger =
      context?.trigger ?? (msg.runId.includes(":manual:") ? "manual" : "schedule");
    const settleManualClaim = async (ok: boolean): Promise<void> => {
      await settleManualClaimForDispatchResult({
        repo,
        automationId,
        runId: msg.runId,
        workspaceKey,
        ok,
        logError: (message) => log("error", message),
      });
    };

    if (msg.ok) {
      if (trigger === "manual") {
        await repo.markManualRunDispatched({
          runId: msg.runId,
          sessionId: msg.sessionId ?? null,
          dispatchedAt: atTime,
        });
        await settleManualClaim(true);
        return;
      }
      await repo.markRunDispatch({
        runId: msg.runId,
        dispatchStatus: "dispatched",
        sessionId: msg.sessionId ?? null,
      });
      const automation = await repo.get(automationId);
      const nextRunAt = automation ? computeAutomationNextRunAt(automation, atTime) : null;
      await repo.markDispatched(automationId, { dispatchedAt: atTime, nextRunAt });
      return;
    }

    await repo.markRunDispatch({
      runId: msg.runId,
      dispatchStatus: "failed_to_dispatch",
      error: msg.error ?? "dispatch failed",
    });
    if (trigger === "manual") {
      await settleManualClaim(false);
      return;
    }
    const kind = msg.failureKind ?? "transient";
    await repo.markDispatchFailed(automationId, {
      failedAt: atTime,
      error: msg.error ?? "dispatch failed",
      kind,
      // transient 达上限后循环任务跳下一个正常 next_run_at。
      nextRunAt: await repo
        .get(automationId)
        .then((automation) => (automation ? computeAutomationNextRunAt(automation, atTime) : null)),
    });
  }

  async function releaseInFlight(): Promise<void> {
    for (const [, context] of inFlight) {
      try {
        if (context.trigger === "manual") {
          await repo.releaseManualClaim(context.automationId, context.workspaceKey);
        } else {
          await repo.releaseClaim(context.automationId);
        }
      } catch {
        // 忽略：退出路径尽力而为。
      }
    }
    inFlight.clear();
  }

  return {
    async claimAndDispatchDue(atTime) {
      const claimed = await repo.claimDue(atTime);
      for (const automation of claimed) {
        await handleClaimed(automation, atTime);
      }
    },
    async claimAndDispatchManualRuns(atTime) {
      const manualRuns = await repo.claimManualRuns(atTime);
      for (const manualRun of manualRuns) {
        await handleClaimedManual(manualRun.automation, manualRun.run);
      }
    },
    settleDispatchResult,
    releaseInFlight,
  };
}
