import type { ZCodeTaskMode } from "./zcode-task-types-core.js";
import type { ModelSelection } from "./model-selection.js";

// ---- 闲时任务(Off-Peak Task)领域类型（P3 本地化重构）----
// off_peak_tasks 存 tasks-index.sqlite。
// 与 automation 共用 scheduler 进程与派发管道，但数据表、消息类型、状态机全部独立，
// 禁止往 ZCodeAutomation 上加字段。sqlite 列名 snake_case，此处为跨域 camelCase 领域类型。
// P3 起准入完全本地化：服务端票据/取号/灰度/套餐资格类型已删除，
// 调度判据只剩 settings.offPeakWindow 时间窗（见 off-peak-window.ts）。

/**
 * 客户端执行态六态：
 * queued=排队等时间窗；paused=用户 Pause 停止派发；running=执行中；
 * completed/failed/cancelled=终态。
 */
export type ZCodeOffPeakTaskStatus =
  | "queued"
  | "paused"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** 终态集合：不可逆出（状态机不变量）。 */
export const OFF_PEAK_TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

export function isOffPeakTerminalStatus(
  status: ZCodeOffPeakTaskStatus,
): status is "completed" | "failed" | "cancelled" {
  return (OFF_PEAK_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** 一条闲时任务：表单创建即入队，派发时 createTask 新建 session，执行用任务保存的模型选择。 */
export interface ZCodeOffPeakTask {
  /** 本地主键。 */
  offPeakTaskId: string;
  /** 表单 Task title。 */
  title: string;
  /** 宿主对话 taskId；首次派发成功后回填（表单：新建 session；会话内创建：绑定会话首跑），非空 = 已跑过。 */
  conversationId?: string;
  /**
   * 运行会话。表单创建首跑后回填；会话内创建在创建时即写入当前会话 id，
   * 首跑 resume 该会话而不新建。续跑/中断恢复 resume 同一 session 用。
   */
  sessionId?: string;
  /** 绑定会话的当前标题（list 时从 tasks-index 联查，只读派生，不落库）。 */
  sessionTitle?: string;
  /** 表单 Instructions。 */
  prompt: string;
  /** 权限四档全开放，映射现有 ZCodeTaskMode，默认 "build"。 */
  permissionMode: ZCodeTaskMode;
  /**
   * 创建被接受时固定的结构化 Submission 选择（用户自己配置的任意 Provider）。
   *
   * 旧数据库记录可能只有 model/thought_level，读取时暂时为空；这类任务必须保留给用户
   * 修复，但在补回完整 Selection 前不能进入调度。
   */
  modelSelection?: ModelSelection;
  /** 旧记录无法可靠恢复 Selection 时的只读诊断事实。 */
  modelSelectionIssue?: {
    code: "repair-required";
    legacyModelId?: string;
    legacyReasoningLevel?: string;
  };
  /** workspaceIdentity?.trim() || workspacePath */
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  status: ZCodeOffPeakTaskStatus;
  /** FIFO 序依据（本地入队时间）。 */
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  failureReason?: string;
  /** 完成通知与状态条展示；复用现有 task diff 回填。 */
  filesChanged?: number;
  /**
   * 用户删除本地 History 行的时间。
   * 只控制 History 可见性，不删除 task/session，也不清空任何执行字段。
   */
  historyDeletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** 创建闲时任务的入参（workspace 由调用方从上下文注入；准入在本地时间窗求值，创建即落库）。 */
export interface ZCodeOffPeakTaskCreateParams {
  title: string;
  prompt: string;
  permissionMode: ZCodeTaskMode;
  modelSelection: ModelSelection;
  workspacePath: string;
  workspaceIdentity?: string;
  /** 会话内创建：绑定创建时所在会话，首跑 resume 该会话（对齐 CronCreate targetTaskId）。表单创建不传。 */
  boundSessionId?: string;
}

export type OffPeakTaskCreateFailureStage = "client_validation" | "local_persist";

export type OffPeakTaskCreateErrorCategory =
  | "client_validation"
  | "network"
  | "local_persist"
  | "unknown";

/**
 * 创建 RPC 的判别联合。失败只保留稳定分类，禁止把 raw error 或响应体带过 RPC；
 * P3 起创建是纯本地校验+落库，不再有服务端取号阶段与 3101/3103 套餐错误。
 */
export type OffPeakTaskCreateResult =
  | {
      ok: true;
      task: ZCodeOffPeakTask;
    }
  | {
      ok: false;
      failureStage: OffPeakTaskCreateFailureStage;
      errorCategory: OffPeakTaskCreateErrorCategory;
      errorCode: string;
    };
