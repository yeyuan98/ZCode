import { ModelSelectionFacade, type ProviderRegistryFacadeSource } from "@zcode/provider";
import { resolveLegacyReasoningLevel } from "./legacy-reasoning-level.js";

/** Host 与受管 Worker 共用身份分类；解析仍由纯 Provider Facade 负责。
 *  P3 C4 供应商 family/specs 删除：account:* 套餐 provider 身份判定
 *  （isBuiltinModelProviderId / isStartPlanModelProviderId）已随账号概念移除，
 *  所有 provider id 统一按普通 API-key Provider 分类。 */
export function createNodeModelSelectionFacade(
  source: ProviderRegistryFacadeSource,
): ModelSelectionFacade {
  return new ModelSelectionFacade(source, () => "ordinary", resolveLegacyReasoningLevel);
}
