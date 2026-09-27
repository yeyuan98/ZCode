/* eslint-disable max-lines -- 模型供应商 schema、迁移和运行时投影 helper 需要共享同一套类型边界，暂时集中在单文件避免契约分散。 */
// P3 C4 供应商 family/specs 删除：BUILTIN_MODEL_PROVIDER_IDS、Builtin*ProviderId 与
// 六个 vendor guard（zai/bigmodel 套餐 provider 身份判定）已随账号套餐概念整体移除；
// 仅保留中性的内置模板 id 与连通性结果契约。
export const BUILTIN_PROVIDER_TEMPLATE_IDS = {
  zai: "zai-api",
  bigmodel: "bigmodel-api",
} as const;

/** 一个正式 Model 的连通性测试结果。 */
export type ModelConnectivityResult =
  | { readonly success: true }
  | {
      readonly success: false;
      readonly error: {
        readonly message: string;
        /** 设置连接测试边界已确认的资格失败；其他执行错误保留原消息。 */
        readonly code?: "provider-unavailable" | "model-unavailable";
      };
    };
