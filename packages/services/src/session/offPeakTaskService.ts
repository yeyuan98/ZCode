/* off-peak 任务编排服务（host 域，仿 automationService 形态）——P3 本地化重构。
   职责：
   - 创建即落库（纯本地校验；无取号、无服务端额度、无灰度门）
   - 取消/暂停/继续/删除/编辑 的状态守卫编排；Run-now 强制派发转发
   - 模型选择解析/校验：执行用任务持久化的 Selection（用户自己配置的任意 Provider）
   服务端票据轮询（offPeakTaskSync）、终态核销 outbox、3102 续跑重取号已随供应商
   票据模型一并删除；可调度判据只剩 settings.offPeakWindow 时间窗（scheduler→main 求值）。 */
import { randomUUID } from "node:crypto";
import {
  isOffPeakTerminalStatus,
  resolveWorkspaceKey,
  type OffPeakTaskCreateResult,
  type ZCodeOffPeakTask,
  type ZCodeOffPeakTaskCreateParams,
} from "@zcode/shared";
import type { ServiceLogger } from "../logger/serviceLogger.js";
import { isOffPeakBoundSessionConflict, type OffPeakTaskRepo } from "./offPeakTaskRepo.js";
import type { IOffPeakTaskService, OffPeakUpdateTaskParams } from "./offPeakTask.js";
import type { ModelSelection, ModelSelectionValidation } from "@zcode/provider";

interface OffPeakTaskServiceDeps {
  repo: OffPeakTaskRepo;
  /**
   * 按当前 Registry 解析并校验模型选择；省略 modelId 时回落用户当前默认选择。
   * P3 起不限定 Provider 白名单——资格 = 存在可解析的持久化选择（用户自己的 Provider）。
   */
  resolveModelSelection: (input: {
    readonly modelId?: string;
    readonly reasoningLevel?: string;
  }) => Promise<
    | { readonly ok: true; readonly selection: ModelSelection }
    | { readonly ok: false; readonly validation: ModelSelectionValidation }
  >;
  logger: ServiceLogger;
  /** 创建/继续后唤醒 scheduler tick（时间窗已开时可立即派发；缺省等 20s 轮询）。 */
  requestSchedulerWake?: () => void;
  /** Run-now 强制派发：host→main→scheduler 通道转发（P3 本地准入）。 */
  requestRunNow?: (offPeakTaskId: string) => void;
  /** 取消 running 任务时中止其 agent loop（host 注入；best-effort）。 */
  stopRunningTask?: (params: {
    conversationId: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }) => Promise<void>;
  /** 列表变化广播钩子（UI 刷新）。 */
  onTasksChanged?: () => void;
  /** 测试注入时钟。 */
  now?: () => number;
}

const VALID_CREATE_PERMISSION_MODES = new Set([
  "yolo",
  "plan",
  "edit",
  "auto",
  "autoEdit",
  "build",
]);

function isValidCreateParams(params: ZCodeOffPeakTaskCreateParams): boolean {
  return (
    typeof params.title === "string" &&
    params.title.trim().length > 0 &&
    typeof params.prompt === "string" &&
    params.prompt.trim().length > 0 &&
    typeof params.workspacePath === "string" &&
    params.workspacePath.trim().length > 0 &&
    typeof params.permissionMode === "string" &&
    VALID_CREATE_PERMISSION_MODES.has(params.permissionMode)
  );
}

const OFF_PEAK_SESSION_BOUND_FAILURE = {
  failureStage: "client_validation",
  errorCategory: "client_validation",
  errorCode: "session_bound",
} as const;

const OFF_PEAK_INVALID_PARAMS_FAILURE = {
  failureStage: "client_validation",
  errorCategory: "client_validation",
  errorCode: "client_validation",
} as const;

const OFF_PEAK_INVALID_SELECTION_FAILURE = {
  failureStage: "client_validation",
  errorCategory: "client_validation",
  errorCode: "model_selection_invalid",
} as const;

export class OffPeakTaskService implements IOffPeakTaskService {
  constructor(private readonly deps: OffPeakTaskServiceDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private emitChanged(): void {
    try {
      this.deps.onTasksChanged?.();
    } catch (error) {
      this.deps.logger.warn("off-peak onTasksChanged 回调失败:", error);
    }
  }

  // ---- 管理操作 ----

  /** Host 派发前的窄检查；最终执行仍由目标 Agent ModelFactory 重新校验。 */
  async validateDispatchModelSelection(selection: ModelSelection): Promise<boolean> {
    const resolved = await this.deps.resolveModelSelection({
      modelId: selection.modelId,
      ...(selection.options?.reasoningLevel
        ? { reasoningLevel: selection.options.reasoningLevel }
        : {}),
    });
    return (
      resolved.ok &&
      resolved.selection.providerId === selection.providerId &&
      resolved.selection.modelId === selection.modelId
    );
  }

  /**
   * 解析创建用模型选择（OffPeakCreate 工具路径）。显式 modelId 不在视图内 → false
   * （协议层翻译 model_not_allowed）；省略回落用户默认/视图推荐。
   */
  async resolveCreateSelection(input: {
    modelId?: string;
    reasoningLevel?: string;
  }): Promise<{ ok: true; selection: ModelSelection } | { ok: false }> {
    const resolved = await this.deps.resolveModelSelection(input);
    return resolved.ok ? { ok: true, selection: resolved.selection } : { ok: false };
  }

  /**
   * 创建即落库（P3）：纯本地校验 + sqlite INSERT，无取号、无额度检查。
   * 资格 = 传入的模型选择可由当前 Registry 解析（用户自己的 Provider，无白名单）。
   * 失败只返回稳定分类，绝不跨 RPC 返回 raw error。
   */
  async createTask(params: ZCodeOffPeakTaskCreateParams): Promise<OffPeakTaskCreateResult> {
    if (!isValidCreateParams(params)) {
      return { ok: false, ...OFF_PEAK_INVALID_PARAMS_FAILURE };
    }
    const selection = await this.deps.resolveModelSelection({
      modelId: params.modelSelection.modelId,
      ...(params.modelSelection.options?.reasoningLevel
        ? { reasoningLevel: params.modelSelection.options.reasoningLevel }
        : {}),
    });
    if (!selection.ok) {
      return { ok: false, ...OFF_PEAK_INVALID_SELECTION_FAILURE };
    }
    const normalizedParams: ZCodeOffPeakTaskCreateParams = {
      ...params,
      modelSelection: selection.selection,
    };
    // 绑定会话已有未终态任务即拒；并发穿过预检的一方由 idx_off_peak_bound_active
    // 在 INSERT 时拒绝（见下方 local_persist 分支）。
    if (
      params.boundSessionId &&
      (await this.deps.repo.hasActiveBoundTask(
        resolveWorkspaceKey({
          workspacePath: params.workspacePath,
          workspaceIdentity: params.workspaceIdentity,
        }),
        params.boundSessionId,
      ))
    ) {
      return { ok: false, ...OFF_PEAK_SESSION_BOUND_FAILURE };
    }
    const offPeakTaskId = `offpeak-${randomUUID()}`;
    let created: ZCodeOffPeakTask;
    try {
      created = await this.deps.repo.create(normalizedParams, { offPeakTaskId });
    } catch (error) {
      if (isOffPeakBoundSessionConflict(error)) {
        return { ok: false, ...OFF_PEAK_SESSION_BOUND_FAILURE };
      }
      this.deps.logger.warn("off-peak task persist failed:", error);
      return {
        ok: false,
        failureStage: "local_persist",
        errorCategory: "local_persist",
        errorCode: "persist_failed",
      };
    }
    this.deps.logger.info(`off-peak task created id=${offPeakTaskId}`);
    this.emitChanged();
    // 时间窗此刻开着的话立即唤醒 scheduler 认领；关着也无害（认领前会被准入拦下）。
    try {
      this.deps.requestSchedulerWake?.();
    } catch (error) {
      this.deps.logger.warn("off-peak scheduler wake failed after create:", error);
    }
    return { ok: true, task: created };
  }

  /**
   * 取消（任意非终态）：先落终态再停 loop——顺序保证 loop 的 stopped 迟到回写
   * 被终态守卫丢弃，不会覆盖 cancelled（幂等）。
   */
  async cancelTask(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null> {
    const existing = await this.deps.repo.get(offPeakTaskId);
    if (!existing || isOffPeakTerminalStatus(existing.status)) return existing;
    const cancelled = await this.deps.repo.markTerminal(offPeakTaskId, {
      status: "cancelled",
      endedAt: this.now(),
    });
    if (!cancelled) return this.deps.repo.get(offPeakTaskId);
    if (existing.status === "running" && existing.conversationId && this.deps.stopRunningTask) {
      try {
        await this.deps.stopRunningTask({
          conversationId: existing.conversationId,
          workspacePath: existing.workspacePath,
          ...(existing.workspaceIdentity ? { workspaceIdentity: existing.workspaceIdentity } : {}),
        });
      } catch (error) {
        this.deps.logger.warn(`off-peak cancel stop loop failed task=${offPeakTaskId}:`, error);
      }
    }
    this.emitChanged();
    return cancelled;
  }

  /** Pause：停止本地派发（时间窗开也不会被认领）。 */
  async pauseTask(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null> {
    const paused = await this.deps.repo.setPaused(offPeakTaskId, true, {
      now: this.now(),
    });
    if (paused) this.emitChanged();
    return paused;
  }

  /** Continue：恢复派发资格（P3：无票据有效性检查，纯状态迁移）。 */
  async continueTask(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null> {
    const resumed = await this.deps.repo.setPaused(offPeakTaskId, false, {
      now: this.now(),
    });
    if (!resumed) return null;
    this.emitChanged();
    this.deps.requestSchedulerWake?.();
    return this.deps.repo.get(offPeakTaskId);
  }

  /**
   * Run-now（P3 本地准入）：用户显式触发，绕过时间窗口立即派发。
   * paused 先回 queued（保持任务仍是可调度态）；认领的 single-flight 原子性由
   * scheduler 端 claimOneForRunNow 保证——claim_running=1 时是幂等 no-op。
   */
  async runNow(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null> {
    const existing = await this.deps.repo.get(offPeakTaskId);
    if (!existing || isOffPeakTerminalStatus(existing.status)) {
      return existing ?? null;
    }
    if (existing.status === "paused") {
      const resumed = await this.deps.repo.setPaused(offPeakTaskId, false, {
        now: this.now(),
      });
      if (!resumed) {
        // 认领在途等竞态下 setPaused 会拒绝；此时不需要强制派发（已有派发在途）。
        return this.deps.repo.get(offPeakTaskId);
      }
    }
    try {
      this.deps.requestRunNow?.(offPeakTaskId);
    } catch (error) {
      this.deps.logger.warn(`off-peak run-now forward failed task=${offPeakTaskId}:`, error);
    }
    this.emitChanged();
    return this.deps.repo.get(offPeakTaskId);
  }

  /** 删除：非终态先按取消处理（停 loop），再删行；终态直接删。 */
  async deleteTask(offPeakTaskId: string): Promise<void> {
    const existing = await this.deps.repo.get(offPeakTaskId);
    if (!existing) return;
    if (!isOffPeakTerminalStatus(existing.status)) {
      await this.cancelTask(offPeakTaskId);
    }
    await this.deps.repo.delete(offPeakTaskId);
    this.emitChanged();
  }

  /** Delete history：仅写本地可见性标记，任务与会话继续保留。 */
  async deleteHistory(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null> {
    const updated = await this.deps.repo.markHistoryDeleted(offPeakTaskId, {
      now: this.now(),
    });
    if (updated) this.emitChanged();
    return updated;
  }

  /** 编辑（queued/paused 全字段可编辑；prompt 派发时才读）。 */
  async updateTask(
    offPeakTaskId: string,
    params: OffPeakUpdateTaskParams,
  ): Promise<ZCodeOffPeakTask | null> {
    const existing = await this.deps.repo.get(offPeakTaskId);
    if (!existing) return null;
    if (existing.status !== "queued" && existing.status !== "paused") {
      // running 起锁定编辑（仅取消），终态只读。
      return null;
    }
    // 闲时任务必须保存一个可由当前 Registry 解析的明确模型；清空模型不能退化成
    // “稍后取第一个”，否则编辑时看到的选择和真正派发的模型会发生漂移。
    if (params.modelSelection === null) return null;
    const candidate = params.modelSelection ?? existing.modelSelection;
    if (!candidate) return null;
    const selection = await this.deps.resolveModelSelection({
      modelId: candidate.modelId,
      ...(candidate.options?.reasoningLevel
        ? { reasoningLevel: candidate.options.reasoningLevel }
        : {}),
    });
    if (!selection.ok) return null;
    const normalizedParams: OffPeakUpdateTaskParams = {
      ...params,
      modelSelection: selection.selection,
    };
    const updated = await this.deps.repo.updateEditableFields(offPeakTaskId, normalizedParams, {
      now: this.now(),
    });
    if (updated) this.emitChanged();
    return updated;
  }

  async list(): Promise<ZCodeOffPeakTask[]> {
    return this.projectModelSelectionIssues(await this.deps.repo.list());
  }

  async get(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null> {
    const task = await this.deps.repo.get(offPeakTaskId);
    if (!task) return null;
    return (await this.projectModelSelectionIssues([task]))[0] ?? null;
  }

  /**
   * 只派生当前配置诊断，不写数据库；旧字段仅由 migration 处理。
   */
  private async projectModelSelectionIssues(
    tasks: readonly ZCodeOffPeakTask[],
  ): Promise<ZCodeOffPeakTask[]> {
    const repaired: ZCodeOffPeakTask[] = [];
    for (const task of tasks) {
      if (task.modelSelection) {
        // 读取时把当前不可用写成 NULL 会永久丢掉原选择并诱发旧字段重绑。
        // 新结构只派生诊断，不写任务；终态不再使用模型，无需重新检查。
        const usable =
          isOffPeakTerminalStatus(task.status) ||
          (await this.validateDispatchModelSelection(task.modelSelection));
        repaired.push(
          usable
            ? task
            : {
                ...task,
                modelSelectionIssue: {
                  code: "repair-required",
                  legacyModelId: task.modelSelection.modelId,
                  legacyReasoningLevel: task.modelSelection.options?.reasoningLevel,
                },
              },
        );
        continue;
      }
      // 数据库迁移无法确定旧 Provider 时保持缺失；读取不补迁、不重绑。
      repaired.push(task);
    }
    return repaired;
  }

  /** disposeServiceResources 钩子：host 退出统一回收（P3：无轮询/网关需要停止，保留空实现占位）。 */
  disposeAll(): void {
    // 服务端票据轮询与 mock 网关已删除；此处保留钩子以免调用方分叉。
  }
}
