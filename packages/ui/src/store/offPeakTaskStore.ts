import { create } from "zustand";
import {
  type OffPeakTaskCreateResult,
  type ZCodeOffPeakTask,
  type ModelSelection,
} from "@zcode/shared";
import type { IOffPeakTaskService } from "@zcode/services";
import { logger } from "@/logger.js";

// 闲时任务管理 store（与 automationManagementStore 独立）：走 IOffPeakTaskService RPC。
// P3 本地化重构：准入只剩时间窗（desktop main 求值）——灰度配置、Coding Plan 支持
// 快照与取号额度已删除；创建资格 = Registry 中存在可选模型（AutomationsSection 依据
// provider view 判定，本 store 不再保存资格状态）。

interface CreateOffPeakTaskInput {
  title: string;
  prompt: string;
  /** 权限四档（build/edit/plan/yolo）；类型收窄在服务端入参处完成。 */
  permissionMode: string;
  modelSelection: ModelSelection;
  workspacePath: string;
  workspaceIdentity?: string;
}

interface UpdateOffPeakTaskInput {
  title?: string;
  prompt?: string;
  permissionMode?: string;
  modelSelection?: ModelSelection | null;
}

/** New task 页模板卡点击后携带到 Automations 创建表单的预填草稿（模板=预填）。 */
export interface OffPeakCreateDraft {
  title?: string;
  prompt?: string;
  telemetrySource?: {
    eventRegion: "app.session" | "app.automations";
    templateId: string;
  };
}

interface OffPeakTaskState {
  tasks: ZCodeOffPeakTask[];
  loading: boolean;
  error: string | null;
  operationId: string | null;
  // P5 D-P5.4：pendingCreateDraft（模板卡→创建表单预填）已随模板链路删除（生产者已不存在）。
  initialize(deps: { offPeakTaskService: IOffPeakTaskService }): Promise<void>;
  refresh(service: IOffPeakTaskService): Promise<void>;
  createTask(
    input: CreateOffPeakTaskInput,
    service: IOffPeakTaskService,
  ): Promise<OffPeakTaskCreateResult>;
  updateTask(
    offPeakTaskId: string,
    input: UpdateOffPeakTaskInput,
    service: IOffPeakTaskService,
  ): Promise<boolean>;
  pauseTask(offPeakTaskId: string, service: IOffPeakTaskService): Promise<void>;
  continueTask(offPeakTaskId: string, service: IOffPeakTaskService): Promise<void>;
  runNow(offPeakTaskId: string, service: IOffPeakTaskService): Promise<void>;
  cancelTask(offPeakTaskId: string, service: IOffPeakTaskService): Promise<void>;
  deleteTask(offPeakTaskId: string, service: IOffPeakTaskService): Promise<void>;
  deleteHistory(offPeakTaskId: string, service: IOffPeakTaskService): Promise<void>;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type OffPeakCreateErrorMessageId = "offPeak.error.unavailable" | "offPeak.error.generic";

/** 创建失败只按稳定分类映射；原始 RPC 文本仅留日志，不直接展示给用户。 */
export function resolveOffPeakCreateErrorMessageId(
  result: OffPeakTaskCreateResult | null | undefined,
): OffPeakCreateErrorMessageId {
  if (
    result?.ok === false &&
    (result.errorCategory === "network" || result.errorCategory === "unknown")
  ) {
    return "offPeak.error.unavailable";
  }
  return "offPeak.error.generic";
}

let initializeInFlight: Promise<void> | null = null;

export const useOffPeakTaskStore = create<OffPeakTaskState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,
  operationId: null,

  async initialize({ offPeakTaskService }) {
    // 页面切换时 New Task 与 Automations 可能短暂重叠挂载；store 级 single-flight
    // 保证列表只拉一次（P3：无灰度/额度请求需要合并）。
    if (initializeInFlight) return initializeInFlight;
    set({ loading: true, error: null });
    const run = (async () => {
      try {
        const tasks = await offPeakTaskService.list();
        set({ tasks });
      } catch (error) {
        logger.warn("[off-peak] list failed", toErrorMessage(error));
        set({ tasks: [] });
      }
    })();
    initializeInFlight = run;
    try {
      await run;
    } finally {
      if (initializeInFlight === run) {
        initializeInFlight = null;
        set({ loading: false });
      }
    }
  },

  async refresh(service) {
    try {
      const tasks = await service.list();
      set({ tasks, error: null });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  async createTask(input, service) {
    set({ operationId: "offpeak:create", error: null });
    try {
      const result = await service.createTask(
        input as Parameters<IOffPeakTaskService["createTask"]>[0],
      );
      if (result.ok) {
        await get().refresh(service);
        return result;
      }
      // 创建失败保留稳定分类供 toast；不把 raw error 放进 UI 状态。
      set({ error: result.errorCategory });
      logger.warn("[off-peak] create failed", {
        errorCategory: result.errorCategory,
        errorCode: result.errorCode,
        failureStage: result.failureStage,
      });
      return result;
    } catch (error) {
      // Host/RPC transport 仍可能在结构化服务结果之外失败；统一收敛为 network，
      // toast 只消费稳定分类，禁止解析 raw error。
      const result = {
        ok: false,
        failureStage: "client_validation",
        errorCategory: "network",
        errorCode: "",
      } as const satisfies OffPeakTaskCreateResult;
      set({ error: result.errorCategory });
      logger.warn("[off-peak] create RPC transport failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
      return result;
    } finally {
      set({ operationId: null });
    }
  },

  async updateTask(offPeakTaskId, input, service) {
    set({ operationId: `offpeak:update:${offPeakTaskId}`, error: null });
    try {
      const updated = await service.updateTask(offPeakTaskId, input);
      await get().refresh(service);
      return updated !== null;
    } catch (error) {
      set({ error: toErrorMessage(error) });
      return false;
    } finally {
      set({ operationId: null });
    }
  },

  async pauseTask(offPeakTaskId, service) {
    set({ operationId: `offpeak:pause:${offPeakTaskId}`, error: null });
    try {
      await service.pauseTask(offPeakTaskId);
      await get().refresh(service);
    } catch (error) {
      set({ error: toErrorMessage(error) });
    } finally {
      set({ operationId: null });
    }
  },

  async continueTask(offPeakTaskId, service) {
    set({ operationId: `offpeak:continue:${offPeakTaskId}`, error: null });
    try {
      await service.continueTask(offPeakTaskId);
      await get().refresh(service);
    } catch (error) {
      set({ error: toErrorMessage(error) });
    } finally {
      set({ operationId: null });
    }
  },

  async runNow(offPeakTaskId, service) {
    // Run-now（P3）：绕过时间窗强制派发；scheduler 端幂等 no-op（claim_running=1）。
    set({ operationId: `offpeak:run-now:${offPeakTaskId}`, error: null });
    try {
      await service.runNow(offPeakTaskId);
      await get().refresh(service);
    } catch (error) {
      set({ error: toErrorMessage(error) });
    } finally {
      set({ operationId: null });
    }
  },

  async cancelTask(offPeakTaskId, service) {
    set({ operationId: `offpeak:cancel:${offPeakTaskId}`, error: null });
    try {
      await service.cancelTask(offPeakTaskId);
      await get().refresh(service);
    } catch (error) {
      set({ error: toErrorMessage(error) });
    } finally {
      set({ operationId: null });
    }
  },

  async deleteTask(offPeakTaskId, service) {
    set({ operationId: `offpeak:delete:${offPeakTaskId}`, error: null });
    try {
      await service.deleteTask(offPeakTaskId);
      await get().refresh(service);
    } catch (error) {
      set({ error: toErrorMessage(error) });
    } finally {
      set({ operationId: null });
    }
  },

  async deleteHistory(offPeakTaskId, service) {
    set({
      operationId: `offpeak:delete-history:${offPeakTaskId}`,
      error: null,
    });
    try {
      await service.deleteHistory(offPeakTaskId);
      await get().refresh(service);
    } catch (error) {
      set({ error: toErrorMessage(error) });
    } finally {
      set({ operationId: null });
    }
  },
}));
