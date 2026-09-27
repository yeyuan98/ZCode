import { create } from "zustand";
import {
  createDynamicWorkflowClientConfig,
  DEFAULT_DYNAMIC_WORKFLOW_MODE,
  type DynamicWorkflowClientConfig,
} from "@zcode/shared";

// ============================================================
// 动态工作流灰度快照在 renderer 的唯一副本
// ============================================================
//
// P3 C2 供应商套餐/计费面删除：远端快照来源（coding-plan 订阅服务的
// getDynamicWorkflowClientConfig，/api/v1/client/configs 代理）已删除。按 A9 裁决，
// 灰度改为本地常量 OFF：renderer 无 env 访问，快照固定为 fail-closed 的 default
// （disabled）。Host 侧（node.ts）仍按 ZCODE_DYNAMIC_WORKFLOW_MODE env 覆盖折叠，
// dev/preview 档位由 desktop main 写定；renderer 的入口可见性在 C5 重建本地来源前
// 恒为关闭。保留 store 形状（status/enabled/config + loader）以免消费方
// （自动化页、run 面板、SessionPane）连锁改动。

export type DynamicWorkflowAvailabilityStatus = "loading" | "ready";

export interface DynamicWorkflowAvailabilitySnapshot {
  readonly status: DynamicWorkflowAvailabilityStatus;
  /** loading 期间恒为 false：未知即不提供，入口宁可晚半拍出现也不闪一下再收起。 */
  readonly enabled: boolean;
  /** 本地求值恒为 default disabled 快照；`source` 只用于观测。 */
  readonly config: DynamicWorkflowClientConfig | null;
}

interface DynamicWorkflowAvailabilityState extends DynamicWorkflowAvailabilitySnapshot {
  /** 首次取数；本地求值立即就绪，重复调用是 no-op。 */
  ensureLoaded(): Promise<void>;
  /** 远端来源已删除；保留方法形状，语义与 ensureLoaded 相同（本地重求值）。 */
  refresh(): Promise<void>;
}

const LOCAL_SNAPSHOT: DynamicWorkflowAvailabilitySnapshot = {
  status: "ready",
  enabled: false,
  config: createDynamicWorkflowClientConfig(DEFAULT_DYNAMIC_WORKFLOW_MODE, "default"),
};

const INITIAL_SNAPSHOT: DynamicWorkflowAvailabilitySnapshot = {
  status: "loading",
  enabled: false,
  config: null,
};

export const useDynamicWorkflowAvailabilityStore = create<DynamicWorkflowAvailabilityState>(
  (set) => ({
    ...INITIAL_SNAPSHOT,

    ensureLoaded(): Promise<void> {
      set(LOCAL_SNAPSHOT);
      return Promise.resolve();
    },

    refresh(): Promise<void> {
      set(LOCAL_SNAPSHOT);
      return Promise.resolve();
    },
  }),
);
