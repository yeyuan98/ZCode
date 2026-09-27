import { zcodeWorkspaceUpdateDynamicWorkflowPolicyParamsSchema } from "@zcode/shared";
import { parseParams, type ZCodeProtocolAgentServerContext } from "./server-types.js";

/**
 * 动态工作流灰度门。判定权在 Host：
 * P3 C2/C5 后 Host 不再读供应商 /client/configs——快照由本地折叠
 * （ZCODE_DYNAMIC_WORKFLOW_MODE env 覆盖 > 缺省 disabled，dev/preview 档位由
 * desktop main 写定），CLI 只缓存结论，从不读 feature key 或本地覆盖环境变量。
 * 与 off-peak-tool-policy.ts 同构：CLI 进程按 workspace 隔离，缓存一份即可；
 * createRecord 对 legacy create/resume、v4 createSession 与 v4 冷恢复
 * （subscribe → resumePersistedSession，没有 host 参数通道）统一读取。
 * 只影响之后创建/恢复的 record；已活跃 record 的工具面不回收（灰度中途翻转策略一致）。
 */
export async function updateDynamicWorkflowPolicy(
  context: ZCodeProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(zcodeWorkspaceUpdateDynamicWorkflowPolicyParamsSchema, rawParams);
  context.appRuntimePreferences.dynamicWorkflowEnabled = params.enabled;
  return { workspace: params.workspace, enabled: params.enabled };
}
