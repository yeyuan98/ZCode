import type {
  OffPeakTaskCreateResult,
  ZCodeOffPeakTask,
  ZCodeOffPeakTaskCreateParams,
  ModelSelection,
} from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

// 闲时任务管理服务通道（与 automation 服务面互不复用）。
// renderer 经 ProxyChannel 直连；P3 起准入完全本地化（时间窗求值在 desktop main），
// 无服务端轮询/取号/核销面。

export interface OffPeakUpdateTaskParams {
  title?: string;
  prompt?: string;
  permissionMode?: string;
  /** undefined=不改；Off-Peak Submission 不允许清空为跟随默认。 */
  modelSelection?: ModelSelection | null;
}

export interface IOffPeakTaskService {
  /**
   * 解析创建用模型选择（OffPeakCreate 工具路径）：显式 modelId 按视图反查 Provider，
   * 省略回落用户当前默认；省略档位补最高档。失败返回 false 供协议层翻译稳定错误。
   */
  resolveCreateSelection(input: {
    modelId?: string;
    reasoningLevel?: string;
  }): Promise<{ ok: true; selection: ModelSelection } | { ok: false }>;
  /** 创建即落库（纯本地校验）；失败返回稳定分类，不跨 RPC 传 raw error。 */
  createTask(params: ZCodeOffPeakTaskCreateParams): Promise<OffPeakTaskCreateResult>;
  cancelTask(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null>;
  pauseTask(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null>;
  continueTask(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null>;
  /**
   * Run-now 强制派发（P3 本地准入）：queued/paused 任务绕过窗口立即派发；
   * paused 先回 queued；已在派发在途（claim_running=1）或 running/终态时幂等 no-op。
   * 实际认领由 scheduler 端原子完成（claimOneForRunNow）。
   */
  runNow(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null>;
  deleteTask(offPeakTaskId: string): Promise<void>;
  /** 仅隐藏本地 History 行；不删除 task/session/执行字段。 */
  deleteHistory(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null>;
  updateTask(
    offPeakTaskId: string,
    params: OffPeakUpdateTaskParams,
  ): Promise<ZCodeOffPeakTask | null>;
  list(): Promise<ZCodeOffPeakTask[]>;
  get(offPeakTaskId: string): Promise<ZCodeOffPeakTask | null>;
}

export const IOffPeakTaskService = createServiceDescriptor<IOffPeakTaskService>(
  ServiceChannels.OffPeakTask,
);
