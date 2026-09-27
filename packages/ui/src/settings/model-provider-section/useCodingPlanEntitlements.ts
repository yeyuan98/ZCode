import { useCallback } from "react";
import type { ProviderSettingsView } from "@zcode/services";
import type { CodingPlanEntitlementState } from "@/settings/model-provider-section/constants.js";

/**
 * P3 供应商套餐/配额面删除（S2 过渡 stub）：
 * entitlement 数据源（usageStatsService.getEntitlementSnapshot）已在服务层删除，
 * 这里保留 hook 形状返回空权益与 no-op 刷新，让 ModelProviderSection / Detail /
 * V4 旧调用点维持编译；C4 设置页 de-plan 时随套餐状态卡整体移除。
 */

export interface UsageEntitlementRefreshOptions {
  force?: boolean;
  silent?: boolean;
  reason?: "access" | "auth" | "purchase" | "manual";
}

export function useCodingPlanAccessRefresh({
  refresh,
  selectedPlanKey,
}: {
  refresh: (options?: UsageEntitlementRefreshOptions) => Promise<void>;
  selectedPlanKey: string | null;
}): void {
  // 权益服务已删除：保留签名以免调用方报错，刷新本身是 no-op。
  void refresh;
  void selectedPlanKey;
}

export function useCodingPlanEntitlements({
  providerSettingsView,
  suppressProviderFingerprintAutoRefresh = false,
}: {
  providerSettingsView: ProviderSettingsView | null;
  suppressProviderFingerprintAutoRefresh?: boolean;
}): {
  entitlements: Partial<Record<string, CodingPlanEntitlementState>>;
  /** 当前具备 Account Access、能够独立查询权益的 Start Plan Provider。 */
  enabledStartPlanProviderIds: string[];
  refresh: (options?: UsageEntitlementRefreshOptions) => Promise<void>;
} {
  void providerSettingsView;
  void suppressProviderFingerprintAutoRefresh;
  const refresh = useCallback(async () => {}, []);
  return {
    entitlements: {},
    enabledStartPlanProviderIds: [],
    refresh,
  };
}
