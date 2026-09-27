// ============================================================
// Off-Peak Port - idle-time task creation boundary
// ============================================================
// 与 AutomationPort 兄弟并列。create 返回判别联合而非抛错：失败分类必须跨
// CLI↔host 协议保真到 handler，供模型收到稳定、可行动的错误提示，禁止降级为
// message 字符串判断。P3：创建是纯本地校验+落库——无取号阶段与套餐/额度分类。

import type { OffPeakCreateInput, OffPeakTaskSummary } from "../tools/off-peak.js";

export type OffPeakCreateFailureStage = "client_validation" | "local_persist";

export type OffPeakCreateErrorCategory =
  | "client_validation"
  | "network"
  | "local_persist"
  | "unknown";

export type OffPeakCreateOutcome =
  | { ok: true; task: OffPeakTaskSummary }
  | {
      ok: false;
      failureStage: OffPeakCreateFailureStage;
      errorCategory: OffPeakCreateErrorCategory;
      errorCode: string;
    };

export interface OffPeakCreateContext {
  /** 当前工具调用所在 session；作为闲时任务的绑定会话（首跑 resume 该会话，对齐 CronCreate targetTaskId）。 */
  sessionId?: string;
}

export interface OffPeakPort {
  create(input: OffPeakCreateInput, context?: OffPeakCreateContext): Promise<OffPeakCreateOutcome>;
  list(): Promise<OffPeakTaskSummary[]>;
}
