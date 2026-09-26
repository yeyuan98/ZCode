import type { ProviderSettingsView } from "@zcode/services";
import type { UseUsageEntitlementOptions } from "@/hooks/useUsageEntitlement.js";
import { buildUsageEntitlementCacheKey } from "@/lib/usageEntitlementCache.js";

/** 设置、输入框与提交推荐复用原权益缓存；账号身份由 Account Source 的连接指纹提供。 */
export function buildStartPlanEntitlementOptions(
  _view: ProviderSettingsView | null | undefined,
  providerId: string,
): UseUsageEntitlementOptions {
  return {
    // P2：Registry 不再发布 zhipu-account Access；Start 权益查询失去账号来源，恒为停用（P3 重建）。
    enabled: false,
    preferredProviderId: providerId,
    accountAccess: undefined,
    includeSubscription: true,
    allowDisabledPreferredProvider: true,
    requirePreferredProvider: true,
    allowEnvApiKey: false,
    cacheKey: buildUsageEntitlementCacheKey({ providerId, providerFingerprint: "" }),
    refreshOnMount: false,
  };
}
