import { useCodingPlanEntryGate } from "@/settings/CodingPlanEntryButton.js";
/* eslint-disable max-lines -- footer 套餐徽标、升级入口与 entitlement 探测共用同一份
   provider 选择与 family 过滤上下文，拆文件会让 zai/bigmodel 对称性难以追踪。 */
import { useEffect, useMemo } from "react";
import { BUILTIN_MODEL_PROVIDER_IDS, TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON } from "@zcode/shared";
import { BarChart3Icon, RocketIcon } from "lucide-react";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu.js";
import {
  resolveCodingPlanUsageRemainingState,
  type CodingPlanUsageAvailableProvider,
  type CodingPlanUsageRemainingEntitlement,
} from "@/CodingPlanUsageRemainingPanel.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { useUsageEntitlement } from "@/hooks/useUsageEntitlement.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  resolveEntitledAccountProviderAccess,
  resolveEntitledAccountProviderAccessFingerprint,
} from "@/lib/accountProviderAccess.js";
import { buildUsageEntitlementCacheKey } from "@/lib/usageEntitlementCache.js";
import { isMaxCodingPlanSnapshot } from "@/lib/sidebarCodingPlanUpgrade.js";
import {
  type SidebarUsageCodingPlanProviderId,
  type SidebarUsageCodingPlanSourceId,
} from "@/lib/sidebarUsageCodingPlanProviderPreference.js";
import { setPendingSettingsUsageIntent } from "@/lib/settingsNavigation.js";
import {
  resolveSidebarFooterPlanBadgeLabel,
  resolveSidebarFooterProfilePlanBadge,
} from "@/WorkspaceSidebarFooterPlanBadgeHelpers.js";

const TID_SIDEBAR_CODING_PLAN_UPGRADE_BUTTON = "sidebar-coding-plan-upgrade-button";

export function useWorkspaceSidebarFooterUsageSummaryState({ enabled }: { enabled: boolean }) {
  const providerSettingsRead = useProviderSettingsView();
  const providerSettingsView =
    providerSettingsRead.state.status === "ready" ? providerSettingsRead.state.view : null;
  // 首次读取失败也不能被解释成“已经加载且没有套餐”；只有 Ready 才能消费 Provider 事实。
  const providerSourcesLoading = providerSettingsRead.state.status !== "ready";
  const availableCodingPlanProviders = useMemo(
    () =>
      [
        BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      ].flatMap((providerId): CodingPlanUsageAvailableProvider[] => {
        const access = resolveEntitledAccountProviderAccess(providerSettingsView, providerId);
        if (!access) return [];
        return [
          {
            providerId,
            accountAccess: access.access,
            label:
              access.label ||
              (providerId === BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan
                ? "Z.ai - Coding Plan"
                : "BigModel - Coding Plan"),
          },
        ];
      }),
    [providerSettingsView],
  );
  const zaiProvider = availableCodingPlanProviders.find(
    (provider) => provider.providerId === BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
  );
  const bigmodelProvider = availableCodingPlanProviders.find(
    (provider) => provider.providerId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
  );
  const zaiProviderFingerprint = resolveEntitledAccountProviderAccessFingerprint(
    providerSettingsView,
    BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
  );
  const bigmodelProviderFingerprint = resolveEntitledAccountProviderAccessFingerprint(
    providerSettingsView,
    BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
  );
  const zaiTeamProvider = resolveEntitledAccountProviderAccess(
    providerSettingsView,
    BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan,
  );
  const bigmodelTeamProvider = resolveEntitledAccountProviderAccess(
    providerSettingsView,
    BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
  );
  // P1：providerFamilyDomain / providerFamilyConnectionSelections 已删除，
  // footer 不再按运行域过滤 family，也没有选中连接的团队用量来源（P3 重建）。
  // P1：当前用量来源原由 providerFamilyConnectionSelections 解析，字段删除后不再有“当前连接”概念（P3 重建）。
  const selectedProviderId: SidebarUsageCodingPlanSourceId | undefined = undefined;

  const zaiEntitlement = useUsageEntitlement({
    enabled: enabled && !providerSourcesLoading && Boolean(zaiProvider),
    includeSubscription: true,
    preferredProviderId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
    accountAccess: resolveEntitledAccountProviderAccess(
      providerSettingsView,
      BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
    )?.access,
    allowDisabledPreferredProvider: true,
    requirePreferredProvider: true,
    allowEnvApiKey: false,
    cacheKey: buildUsageEntitlementCacheKey({
      providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
      providerFingerprint: zaiProviderFingerprint,
    }),
    refreshOnMount: false,
  });
  const bigmodelEntitlement = useUsageEntitlement({
    enabled: enabled && !providerSourcesLoading && Boolean(bigmodelProvider),
    includeSubscription: true,
    preferredProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    accountAccess: resolveEntitledAccountProviderAccess(
      providerSettingsView,
      BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    )?.access,
    allowDisabledPreferredProvider: true,
    requirePreferredProvider: true,
    allowEnvApiKey: false,
    cacheKey: buildUsageEntitlementCacheKey({
      providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
      providerFingerprint: bigmodelProviderFingerprint,
    }),
    refreshOnMount: false,
  });
  const teamEntitlement = useUsageEntitlement({
    // P1：当前连接来源（providerFamilyConnectionSelections）已删除，无法定位选中 Team 连接，
    // footer 暂不查询团队额度（P3 重建）。
    enabled: false,
    includeSubscription: true,
    preferredProviderId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    allowDisabledPreferredProvider: true,
    requirePreferredProvider: true,
    allowEnvApiKey: false,
    refreshOnMount: false,
  });
  // footer 是常驻入口，refreshOnMount: false 后冷启动没有其它
  // 入口预热 entitlement，个人计划徽标缺失。可见时触发一次 access 刷新，复用共享
  // 1 分钟 freshness window、失败退避和 in-flight 合并；hook disabled 时 refresh 是 no-op。
  useEffect(() => {
    for (const refresh of [
      zaiEntitlement.refresh,
      bigmodelEntitlement.refresh,
      teamEntitlement.refresh,
    ]) {
      void refresh({ silent: true, reason: "access" });
    }
  }, [zaiEntitlement.refresh, bigmodelEntitlement.refresh, teamEntitlement.refresh]);
  const profilePlanBadge = resolveSidebarFooterProfilePlanBadge({
    individualEntitlements: [
      {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
        snapshot: zaiEntitlement.snapshot,
        loading: zaiEntitlement.loading,
      },
      {
        providerId: BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
        snapshot: bigmodelEntitlement.snapshot,
        loading: bigmodelEntitlement.loading,
      },
    ],
    // 头像徽标使用账号的 Team entitlement；pricing 结果只负责额度来源和套餐详情。
    hasTeamPlanEntitlement: Boolean(zaiTeamProvider || bigmodelTeamProvider),
  });
  // P1：当前连接来源（providerFamilyConnectionSelections）已删除，footer 汇总不再按选中套餐投影（P3 重建）。
  const providerEntitlements: CodingPlanUsageRemainingEntitlement[] = [];
  const usageState = resolveCodingPlanUsageRemainingState({
    availableProviders: availableCodingPlanProviders,
    entitlements: providerEntitlements,
    modelProvidersLoading: providerSourcesLoading,
    selectedProviderId,
  });
  const visibleUsageState = usageState?.hasAnyActiveCodingPlan ? usageState : null;
  const selectedUpgradeProviderId: SidebarUsageCodingPlanProviderId | undefined =
    selectedProviderId === BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan ||
    selectedProviderId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan
      ? selectedProviderId
      : undefined;
  const upgradeTargetProviderId =
    selectedUpgradeProviderId ??
    availableCodingPlanProviders[0]?.providerId ??
    // P1：providerFamilyDomain 已删除，升级入口无运行域可回退时默认 Z.ai 品牌。
    BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan;
  return {
    audience: undefined,
    availableCodingPlanProviders,
    providerSourcesLoading,
    providerEntitlements,
    profilePlanBadge,
    selectedProviderId,
    upgradeTargetProviderId,
    usageState: visibleUsageState,
  };
}

type WorkspaceSidebarFooterUsageSummaryState = ReturnType<
  typeof useWorkspaceSidebarFooterUsageSummaryState
>;

export function WorkspaceSidebarFooterUsageSummaryContent({
  state,
  onUsageClick,
  onUpgradeClick,
}: {
  state: WorkspaceSidebarFooterUsageSummaryState;
  onUsageClick?: () => void;
  onUpgradeClick?: (providerId: SidebarUsageCodingPlanProviderId) => void;
}) {
  const { intl } = useZCodeIntl();
  const entryGate = useCodingPlanEntryGate();
  const { providerEntitlements, upgradeTargetProviderId } = state;
  const upgradeProviderSnapshot =
    providerEntitlements.find((item) => item.providerId === upgradeTargetProviderId)?.snapshot ??
    null;
  const upgradeActionLabelId = isMaxCodingPlanSnapshot(upgradeProviderSnapshot)
    ? "sidebar.usage.plan.renew"
    : "sidebar.usage.plan.upgrade";

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        data-testid={TID_SIDEBAR_CODING_PLAN_USAGE_BUTTON}
        onSelect={() => {
          setPendingSettingsUsageIntent();
          onUsageClick?.();
        }}
      >
        <BarChart3Icon className="size-4" />
        {intl.formatMessage({ id: "sidebar.usage.plan.openStats" })}
      </DropdownMenuItem>
      {/* 产品要求：升级入口始终显示；未解析出当前套餐时由当前 provider family 决定品牌。 */}
      <DropdownMenuItem
        data-testid={TID_SIDEBAR_CODING_PLAN_UPGRADE_BUTTON}
        disabled={entryGate.status === "loading"}
        aria-busy={entryGate.status === "loading"}
        onSelect={() => {
          if (entryGate.status !== "ready") {
            entryGate.retry?.();
            return;
          }
          onUpgradeClick?.(upgradeTargetProviderId);
        }}
      >
        <RocketIcon className="size-4" />
        {entryGate.label ?? intl.formatMessage({ id: upgradeActionLabelId })}
      </DropdownMenuItem>
    </>
  );
}

export function WorkspaceSidebarFooterPlanBadge({
  state,
}: {
  state: WorkspaceSidebarFooterUsageSummaryState;
}) {
  const { intl } = useZCodeIntl();
  const label =
    state.profilePlanBadge?.audience === "team"
      ? intl.formatMessage({ id: "sidebar.usage.plan.audienceTeam" })
      : resolveSidebarFooterPlanBadgeLabel(state.profilePlanBadge?.snapshot ?? null);
  if (!label) {
    return null;
  }

  return (
    <span
      className="min-w-0 max-w-20 shrink truncate rounded-full border border-border bg-surface px-1 py-px text-ui-xs font-medium leading-normal text-foreground-subtle"
      title={label}
    >
      {label}
    </span>
  );
}
