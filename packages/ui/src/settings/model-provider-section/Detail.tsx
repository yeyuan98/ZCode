/* eslint-disable max-lines -- Model Provider 详情页当前集中编排 Plan Card、API Key 表单和 OAuth 套餐态；后续稳定后再按 family/API/OAuth 拆分。 */
// P3 C2 供应商套餐/计费面删除：购买入口链（CodingPlanPurchaseChoiceBanners、
// useCodingPlanProducts / useEnterpriseCodingPlanProducts、StartPlanCard 预览与
// useCodingPlanUpgradeDialog 官网升级弹窗）已随购买链路删除；本文件只保留
// 套餐状态卡与既有连接管理（C4 设置页 de-plan 时整体收尾）。
import {
  BIGMODEL_PROVIDER_ID,
  ZAI_PROVIDER_ID,
  type BuiltinModelProviderId,
  isStartPlanModelProviderId,
  isIndividualCodingPlanModelProviderId,
  resolveModelProviderFamilySpecByProviderId,
  type ModelConnectivityResult,
  type OAuthProviderId,
} from "@zcode/shared";
import {
  getProviderFormApiKeyManagementUrl,
  type ProviderSettingsFormProvider,
} from "@/lib/providerSettingsFormTypes.js";
import { useEffect, useMemo, useState } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { type CodingPlanStatus, type ModelProviderNavItem } from "./constants.js";
import { InlineEditableProviderCard } from "./InlineEditableProviderCard.js";
import {
  ModelProviderLoadingCard,
  PresetProviderPlaceholderCard,
  CodingPlanStatusPanel,
} from "./StatusCards.js";
import type { CodingPlanLoginOptions } from "./codingPlanPricingCards.js";
import { resolveCodingPlanStatusPanelViewState } from "./codingPlanStatusPanelViewState.js";
import {
  ProviderFamilyDetailShell,
  ProviderFamilyHeader,
  ProviderFamilyPlanModeSwitch,
} from "./ProviderFamilyModeHeader.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import type { ProviderSettingsView } from "@zcode/services";
import type { SavePersonalModelDraftInput } from "@zcode/provider";
import { projectProviderSettingsViewToFormProviders } from "@/lib/providerSettingsFormProjection.js";

// P3 C2 供应商套餐/计费面删除：START/PERSONAL/TEAM_PLAN_ENTRY_BANNER_CLASS
// （购买入口横幅样式）已随购买链路删除。

function isPlanNavItem(
  item: ModelProviderNavItem | null,
): item is Extract<ModelProviderNavItem, { type: "codingPlan" | "teamPlan" }> {
  return item?.type === "codingPlan" || item?.type === "teamPlan";
}

function resolveTeamScopedPlanNavItem(
  item: Extract<ModelProviderNavItem, { type: "codingPlan" | "teamPlan" }>,
): Extract<ModelProviderNavItem, { type: "codingPlan" | "teamPlan" }> {
  return item;
}

function resolveTeamPlanInspectionAccess(
  item: Extract<ModelProviderNavItem, { type: "teamPlan" }>,
) {
  // 不可用套餐仍需查询失效原因；组织/项目身份来自团队导航，不能被执行可用性门禁清空。
  const family = resolveModelProviderFamilySpecByProviderId(item.presetId)?.id;
  const productId = item.currentProductId?.trim();
  const organizationId = item.organizationId?.trim();
  const projectId = item.projectId?.trim();
  if (!family || !productId || !organizationId || !projectId) return undefined;
  return {
    type: "zhipu-account" as const,
    family,
    planKind: "team-coding-plan" as const,
    productId,
    organizationId,
    projectId,
  };
}

function resolvePlanSettingsProvider({
  view,
  providerId,
  fallback,
}: {
  view: ProviderSettingsView | null | undefined;
  providerId: string;
  fallback: ProviderSettingsFormProvider | null;
}): ProviderSettingsFormProvider | null {
  if (view) {
    return (
      projectProviderSettingsViewToFormProviders(view).find(
        (provider) => provider.providerId === providerId,
      ) ?? null
    );
  }
  return fallback?.providerId === providerId ? fallback : null;
}

export function ModelProviderSectionDetail({
  selectedNavItem,
  navigationItems = selectedNavItem ? [selectedNavItem] : [],
  startPlanSubscriptionCount = 0,
  presetLoading,
  codingPlanAuthError,
  presetSubscriptionProviderId,
  codingPlanStatusSyncProviderId,
  codingPlanDisconnectProviderId,
  onSave,
  onAddPersonalModel,
  onSavePersonalModelDraft,
  onSetPersonalModelEnabled,
  onDeletePersonalModel,
  onDelete,
  onReorderProviderModels,
  onTestModel,
  onCodingPlanLogin,
  onRetryCodingPlan,
  onCodingPlanDisconnect,
  onOpenApiKeyUrl,
  onOpenBigModelRegistration,
  onCodingPlanPurchaseComplete,
  onSelectNavItem,
  providerSettingsView: providerSettingsViewOverride,
}: {
  selectedNavItem: ModelProviderNavItem | null;
  navigationItems?: ModelProviderNavItem[];
  startPlanSubscriptionCount?: number;
  presetLoading: boolean;
  codingPlanAuthError?: string | null;
  presetSubscriptionProviderId: BuiltinModelProviderId | null;
  codingPlanStatusSyncProviderId: BuiltinModelProviderId | null;
  codingPlanDisconnectProviderId: BuiltinModelProviderId | null;
  onSave: (config: ProviderSettingsFormProvider) => void | Promise<void>;
  onAddPersonalModel?: (
    providerId: string,
    modelId: string,
    config: ProviderSettingsFormProvider["models"][number]["personalConfig"],
    useRecommendedConfig?: boolean,
  ) => Promise<unknown>;
  onSavePersonalModelDraft?: (input: SavePersonalModelDraftInput) => Promise<unknown>;
  onSetPersonalModelEnabled?: (
    providerId: string,
    modelId: string,
    enabled: boolean,
  ) => Promise<unknown>;
  onDeletePersonalModel?: (providerId: string, modelId: string) => Promise<unknown>;
  onDelete: (provider: ProviderSettingsFormProvider) => Promise<void>;
  onReorderProviderModels?: (providerId: string, modelIds: string[]) => Promise<void>;
  onTestModel: (providerId: string, modelId: string) => Promise<ModelConnectivityResult>;
  onRetryCodingPlan?: () => void | Promise<void>;
  onCodingPlanLogin: (
    presetId: BuiltinModelProviderId,
    providerId: OAuthProviderId,
    providerName: string,
    status: CodingPlanStatus,
    options?: CodingPlanLoginOptions,
  ) => number | void;
  onCodingPlanDisconnect: (
    presetId: BuiltinModelProviderId,
    providerId: OAuthProviderId,
    providerName: string,
  ) => void;
  onOpenApiKeyUrl: (url: string) => void;
  onOpenBigModelRegistration: () => void;
  onCodingPlanPurchaseComplete: () => void | Promise<void>;
  onSelectNavItem?: (item: ModelProviderNavItem) => void;
  providerSettingsView?: ProviderSettingsView | null;
}) {
  const { intl } = useZCodeIntl();
  const loadingLabel = intl.formatMessage({ id: "common.loading" });
  const [upgradePlansVisibleProviderId, setUpgradePlansVisibleProviderId] =
    useState<BuiltinModelProviderId | null>(null);
  const selectedItemKey = selectedNavItem?.key ?? null;
  const rootProviderSettingsRead = useProviderSettingsView();
  const rootProviderSettingsView =
    rootProviderSettingsRead.state.status === "ready" ? rootProviderSettingsRead.state.view : null;
  const providerSettingsView = providerSettingsViewOverride ?? rootProviderSettingsView;
  // 账号分支曾漏传删除回调，出现只删 UI 不写盘。所有详情共用同一套模型操作装配。
  const modelEditingProps = {
    onAddPersonalModel,
    onSavePersonalModelDraft,
    onSetPersonalModelEnabled,
    onDeletePersonalModel,
    settingsRevision: providerSettingsView?.revision,
  };
  const selectedPlanAccess = useMemo(() => {
    if (!isPlanNavItem(selectedNavItem)) return undefined;
    // P2：Registry 账号 Access 解析恒为空；套餐查询身份只剩团队订阅导航（P3 重建个人套餐身份）。
    if (selectedNavItem.type === "teamPlan")
      return resolveTeamPlanInspectionAccess(selectedNavItem);
    return undefined;
  }, [selectedNavItem]);
  // P3 供应商套餐/配额面删除：selectedTeamPlanEntitlement（useUsageEntitlement）、
  // team 上下文与 access 刷新 effect 已随 entitlement 服务面删除。
  const effectiveSelectedPlanNavItem = isPlanNavItem(selectedNavItem)
    ? resolveTeamScopedPlanNavItem(selectedNavItem)
    : null;
  const planModeSwitch = (
    <ProviderFamilyPlanModeSwitch
      selectedNavItem={selectedNavItem}
      navigationItems={navigationItems}
      startPlanSubscriptionCount={startPlanSubscriptionCount}
      onSelectNavItem={onSelectNavItem}
    />
  );

  useEffect(() => {
    setUpgradePlansVisibleProviderId(null);
  }, [selectedItemKey]);

  if (!selectedNavItem) {
    return <ModelProviderLoadingCard loadingLabel={loadingLabel} />;
  }

  if (selectedNavItem.type === "preset") {
    if (!selectedNavItem.provider) {
      // 首屏慢网时预置供应商配置尚未返回，之前这里会直接展示“尚未同步，请先完成 OAuth 登录”，
      // 用户会把“还在下载”误判成“当前账号未登录”。首刷期间改为明确显示 loading，等请求结束后再决定是否展示未同步占位。
      if (presetLoading) {
        return <ModelProviderLoadingCard loadingLabel={loadingLabel} />;
      }

      return <PresetProviderPlaceholderCard displayName={selectedNavItem.displayName} />;
    }

    const presetProvider = selectedNavItem.provider;

    const familySpec = resolveModelProviderFamilySpecByProviderId(selectedNavItem.presetId);
    const presetFamilyHeader = (
      <ProviderFamilyHeader
        selectedNavItem={selectedNavItem}
        trailingAction={familySpec ? planModeSwitch : undefined}
      />
    );
    return (
      <ProviderFamilyDetailShell header={presetFamilyHeader}>
        <InlineEditableProviderCard
          provider={presetProvider}
          onSave={onSave}
          {...modelEditingProps}
          onReorderModelIds={
            onReorderProviderModels
              ? (modelIds) => onReorderProviderModels(presetProvider.providerId, modelIds)
              : undefined
          }
          onTestModel={onTestModel}
          readOnlyEndpoints
          // 预置供应商名称承载固定 API Key 入口语义，
          // 允许重命名会让侧边栏和模型选择器展示含义不一致，因此只允许自定义供应商改名。
          nameEditable={false}
          headerVisible={!familySpec}
          headerActionsVisible={familySpec ? false : undefined}
        />
      </ProviderFamilyDetailShell>
    );
  }

  if (effectiveSelectedPlanNavItem) {
    const selectedNavItem = effectiveSelectedPlanNavItem;
    const dedicatedProvider = resolvePlanSettingsProvider({
      view: providerSettingsView,
      providerId: selectedNavItem.presetId,
      fallback: selectedNavItem.provider,
    });
    // P3 C2：codingPlanPurchaseTokenAuthenticated（购买 token 鉴权态，购买入口横幅
    // 的售罄/目录开关）已随购买链路删除。
    const codingPlanLoginPending = presetSubscriptionProviderId === selectedNavItem.presetId;
    const codingPlanStatusSyncPending = codingPlanStatusSyncProviderId === selectedNavItem.presetId;
    const codingPlanDisconnectPending = codingPlanDisconnectProviderId === selectedNavItem.presetId;
    const hasResolvedEntitlementStatus =
      selectedNavItem.status === "purchased" || selectedNavItem.status === "notPurchased";
    const statusPanelViewState =
      codingPlanDisconnectPending || (codingPlanStatusSyncPending && !hasResolvedEntitlementStatus)
        ? {
            // 登录/登出后的 provider key 与权益刷新是异步链路。
            // 刷新落定前继续展示旧的未连接/已连接状态会让用户误以为操作失败。
            displayStatus: "checking" as const,
            actionStatus: "checking" as const,
            balanceStatus: "checking" as const,
            loginLoading: codingPlanStatusSyncPending,
          }
        : resolveCodingPlanStatusPanelViewState({
            status: selectedNavItem.status,
            loginPending: codingPlanLoginPending || codingPlanStatusSyncPending,
          });
    const visibleStatusLabelId =
      statusPanelViewState.displayStatus === "checking" ? undefined : selectedNavItem.statusLabelId;
    const isStartPlanProvider = isStartPlanModelProviderId(selectedNavItem.presetId);
    // 明确无权益时隐藏配置入口，但查询/取 Key 失败不能推断无权益，也不删除配置。
    const hasNoPlanEntitlement =
      !isStartPlanProvider &&
      (selectedNavItem.type === "teamPlan"
        ? selectedNavItem.availabilityReason === "not-allocated" ||
          selectedNavItem.availabilityReason === "expired"
        : selectedNavItem.status === "notPurchased");
    // Start 已由 Account 快照确认可用时，额度查询清空/刷新自己的缓存不能卸载编辑器。
    // 未取得套餐时不展示可执行模型；配置区不依赖额度请求的临时 loading 状态。
    // P2：accountState 已删除，Start 配置区不再依赖账号快照确认可用。
    const accountAvailable = false;
    const hidePlanModels =
      hasNoPlanEntitlement ||
      selectedNavItem.status === "disconnected" ||
      selectedNavItem.status === "notPurchased";
    const shouldShowDedicatedProviderDetail =
      dedicatedProvider !== null &&
      !hidePlanModels &&
      (!isStartPlanProvider || accountAvailable || selectedNavItem.status === "purchased");
    // P2：accountState.unavailableReason 已删除；凭据失败重登入口失去判定来源（P3 重建）。
    const reloginOnFailure = false;
    // 团队查询/取 Key 失败不是未登录：先刷新 Host 凭据，再刷新当前团队权益。
    const retryTeamPlan =
      selectedNavItem.type === "teamPlan" &&
      selectedNavItem.status === "unavailable" &&
      selectedNavItem.availabilityReason !== "not-allocated" &&
      selectedNavItem.availabilityReason !== "expired" &&
      onRetryCodingPlan
        ? async () => {
            await onRetryCodingPlan();
          }
        : undefined;
    const accessBanner =
      isStartPlanProvider ||
      (selectedNavItem.type === "teamPlan" &&
        (selectedNavItem.availabilityReason === "not-allocated" ||
          selectedNavItem.availabilityReason === "expired"))
        ? null
        : resolveCodingPlanAccessBanner(statusPanelViewState.displayStatus, intl, reloginOnFailure);
    const upgradePlansVisible = upgradePlansVisibleProviderId === selectedNavItem.presetId;
    const handleUpgradePlansVisibleChange = (visible: boolean) => {
      setUpgradePlansVisibleProviderId(visible ? selectedNavItem.presetId : null);
    };
    // P3 C2 供应商套餐/计费面删除：purchaseChoiceBanners / handlePurchaseChoiceSelect
    // （个人/团队购买入口横幅，经 useCodingPlanProducts /
    // useEnterpriseCodingPlanProducts 读价并打开官网升级弹窗）已随购买链路删除。
    const codingPlanFamilyHeader = (
      <ProviderFamilyHeader selectedNavItem={selectedNavItem} trailingAction={planModeSwitch} />
    );
    // 团队导航在 pricing 返回历史 subscribed 时也可能标为 purchased。购买/升级入口
    // 只读取 Account owner 已确认的权益，不能把商品目录的展示状态当成当前权益。
    const hasActivePaidPlan = navigationItems.some(
      (item) =>
        (item.type === "teamPlan" ||
          (item.type === "codingPlan" && isIndividualCodingPlanModelProviderId(item.presetId))) &&
        item.oauthProviderId === selectedNavItem.oauthProviderId &&
        // P2：accountState 已删除；已购套餐的活跃判定失去账号快照来源（P3 重建）。
        false,
    );
    const planSupplementalContent = accessBanner ? (
      <CodingPlanAccessBanner title={accessBanner.title} description={accessBanner.description} />
    ) : null;

    if (shouldShowDedicatedProviderDetail && dedicatedProvider) {
      const statusPanel = (
        <CodingPlanStatusPanel
          providerId={selectedNavItem.presetId}
          providerName={selectedNavItem.providerName}
          status={selectedNavItem.status}
          viewState={statusPanelViewState}
          planLevel={selectedNavItem.planLevel}
          subscriptionRenewTime={selectedNavItem.subscriptionRenewTime}
          subscriptionExpireTime={selectedNavItem.subscriptionExpireTime}
          subscriptionDetails={selectedNavItem.subscriptionDetails}
          quotaLimits={selectedNavItem.quotaLimits}
          mcpQuotaLimit={selectedNavItem.mcpQuotaLimit ?? null}
          authError={codingPlanAuthError}
          onOpenRegistration={onOpenBigModelRegistration}
          purchaseUrl={selectedNavItem.purchaseUrl}
          inactivePlanTitle={selectedNavItem.inactivePlanTitle}
          statusLabelId={visibleStatusLabelId}
          statusMessage={selectedNavItem.statusMessage}
          teamPlanAvailabilityReason={
            selectedNavItem.type === "teamPlan" ? selectedNavItem.availabilityReason : undefined
          }
          quotaResetSourceKey={
            selectedNavItem.type === "teamPlan" ? selectedNavItem.key : selectedNavItem.presetId
          }
          quotaResetAccountAccess={selectedPlanAccess}
          onQuotaResetEntitlementRefresh={onCodingPlanPurchaseComplete}
          onOpenPurchase={onOpenApiKeyUrl}
          onDisconnect={
            (selectedNavItem.oauthProviderId === BIGMODEL_PROVIDER_ID ||
              selectedNavItem.oauthProviderId === ZAI_PROVIDER_ID) &&
            dedicatedProvider.providerId === selectedNavItem.presetId
              ? () => {
                  onCodingPlanDisconnect(
                    selectedNavItem.presetId,
                    selectedNavItem.oauthProviderId,
                    selectedNavItem.providerName,
                  );
                }
              : undefined
          }
          disconnectLoading={codingPlanDisconnectProviderId === selectedNavItem.presetId}
          // Plan Card 在未登录/登录失效时仍然是用户当前选中的入口。
          // 之前详情页没有打开状态卡内置登录动作，导致用户能进入 Coding tab 却只能看到“未连接”文案。
          loginActionVisible
          loginActionPlacement="trailing"
          reloginOnFailure={!upgradePlansVisible && reloginOnFailure}
          onRetry={
            retryTeamPlan ??
            (!upgradePlansVisible &&
            selectedNavItem.type === "codingPlan" &&
            !selectedNavItem.accountLoginRequired &&
            (selectedNavItem.status === "unavailable" ||
              selectedNavItem.statusLabelId ===
                "settings.modelProvider.codingPlan.status.unavailable")
              ? onRetryCodingPlan
              : undefined)
          }
          onLogin={(options) => {
            return onCodingPlanLogin(
              selectedNavItem.presetId,
              selectedNavItem.oauthProviderId,
              selectedNavItem.providerName,
              // 查看套餐接口要求业务 OAuth 仍有效；已购买状态下的“重新链接”不能只静默刷新 key，
              // 否则 OAuth 过期时点击没有可见反馈。升级态的重连强制走重新登录路径。
              upgradePlansVisible ? "unavailable" : selectedNavItem.status,
              options,
            );
          }}
          // P3 C2：onOpenUpgradePlans（打开官网升级弹窗）已随购买链路删除。
          upgradePlansVisible={upgradePlansVisible}
          onUpgradePlansVisibleChange={handleUpgradePlansVisibleChange}
          purchaseInitialAudience={selectedNavItem.type === "teamPlan" ? "team" : "personal"}
          upgradeActionVisible={!isStartPlanProvider || !hasActivePaidPlan}
        />
      );

      return (
        <ProviderFamilyDetailShell header={codingPlanFamilyHeader}>
          <InlineEditableProviderCard
            provider={dedicatedProvider}
            onSave={onSave}
            {...modelEditingProps}
            onReorderModelIds={
              onReorderProviderModels
                ? (modelIds) => onReorderProviderModels(dedicatedProvider.providerId, modelIds)
                : undefined
            }
            onTestModel={onTestModel}
            nameEditable={false}
            statusSection={
              <div className="space-y-3">
                {statusPanel}
                {planSupplementalContent}
              </div>
            }
            headerActionsVisible={false}
          />
        </ProviderFamilyDetailShell>
      );
    }

    return (
      <ProviderFamilyDetailShell header={codingPlanFamilyHeader}>
        <div className="space-y-3">
          <CodingPlanStatusPanel
            providerId={selectedNavItem.presetId}
            providerName={selectedNavItem.providerName}
            status={selectedNavItem.status}
            viewState={statusPanelViewState}
            // 未登录状态下右侧只渲染 Plan Card，不再回退到 API Key 表单。
            // 因此登录入口必须留在 Plan Card 本身，否则用户进入 Coding tab 后没有下一步动作。
            loginActionVisible
            loginActionPlacement="trailing"
            purchaseUrl={selectedNavItem.purchaseUrl}
            planLevel={selectedNavItem.planLevel}
            inactivePlanTitle={selectedNavItem.inactivePlanTitle}
            statusLabelId={visibleStatusLabelId}
            statusMessage={selectedNavItem.statusMessage}
            teamPlanAvailabilityReason={
              selectedNavItem.type === "teamPlan" ? selectedNavItem.availabilityReason : undefined
            }
            quotaResetSourceKey={
              selectedNavItem.type === "teamPlan" ? selectedNavItem.key : selectedNavItem.presetId
            }
            quotaResetAccountAccess={selectedPlanAccess}
            onQuotaResetEntitlementRefresh={onCodingPlanPurchaseComplete}
            subscriptionRenewTime={selectedNavItem.subscriptionRenewTime}
            subscriptionExpireTime={selectedNavItem.subscriptionExpireTime}
            subscriptionDetails={selectedNavItem.subscriptionDetails}
            quotaLimits={selectedNavItem.quotaLimits}
            mcpQuotaLimit={selectedNavItem.mcpQuotaLimit ?? null}
            authError={codingPlanAuthError}
            onOpenRegistration={onOpenBigModelRegistration}
            onLogin={(options) => {
              return onCodingPlanLogin(
                selectedNavItem.presetId,
                selectedNavItem.oauthProviderId,
                selectedNavItem.providerName,
                selectedNavItem.status,
                options,
              );
            }}
            reloginOnFailure={!upgradePlansVisible && reloginOnFailure}
            onRetry={
              retryTeamPlan ??
              (!upgradePlansVisible &&
              selectedNavItem.type === "codingPlan" &&
              !selectedNavItem.accountLoginRequired &&
              (selectedNavItem.status === "unavailable" ||
                selectedNavItem.statusLabelId ===
                  "settings.modelProvider.codingPlan.status.unavailable")
                ? onRetryCodingPlan
                : undefined)
            }
            onOpenPurchase={onOpenApiKeyUrl}
            onDisconnect={
              (selectedNavItem.oauthProviderId === BIGMODEL_PROVIDER_ID ||
                selectedNavItem.oauthProviderId === ZAI_PROVIDER_ID) &&
              selectedNavItem.provider?.providerId === selectedNavItem.presetId &&
              selectedNavItem.status !== "disconnected"
                ? () => {
                    onCodingPlanDisconnect(
                      selectedNavItem.presetId,
                      selectedNavItem.oauthProviderId,
                      selectedNavItem.providerName,
                    );
                  }
                : undefined
            }
            disconnectLoading={codingPlanDisconnectProviderId === selectedNavItem.presetId}
            // P3 C2：onOpenUpgradePlans（打开官网升级弹窗）已随购买链路删除。
            upgradePlansVisible={upgradePlansVisible}
            onUpgradePlansVisibleChange={handleUpgradePlansVisibleChange}
            purchaseInitialAudience={selectedNavItem.type === "teamPlan" ? "team" : "personal"}
            upgradeActionVisible={!isStartPlanProvider || !hasActivePaidPlan}
          />
          {hidePlanModels ? null : providerSettingsView && !dedicatedProvider ? (
            <PresetProviderPlaceholderCard
              displayName={selectedNavItem.providerName}
              messageId="settings.modelProvider.accountProviderConfigMissing"
            />
          ) : !selectedNavItem.provider ||
            selectedNavItem.provider.providerId !== selectedNavItem.presetId ? (
            <ModelProviderLoadingCard loadingLabel={loadingLabel} />
          ) : null}
          {planSupplementalContent}
        </div>
      </ProviderFamilyDetailShell>
    );
  }

  if (selectedNavItem.type === "codingPlanLoading") {
    // Z.AI plan 判定占位只属于左侧导航，不应进入详情表单渲染路径。
    return null;
  }

  if (!selectedNavItem.provider) {
    return <ModelProviderLoadingCard loadingLabel={loadingLabel} />;
  }

  const customProvider = selectedNavItem.provider;
  const customApiKeyUrl = customProvider.templateId
    ? getProviderFormApiKeyManagementUrl(customProvider)
    : undefined;
  return (
    // 仅展示预设模板声明的入口，不根据地址猜测自定义 Provider 的 Key 控制台。
    <InlineEditableProviderCard
      provider={customProvider}
      onSave={onSave}
      {...modelEditingProps}
      onDelete={() => onDelete(customProvider)}
      onReorderModelIds={
        onReorderProviderModels
          ? (modelIds) => onReorderProviderModels(customProvider.providerId, modelIds)
          : undefined
      }
      onTestModel={onTestModel}
      presetApiKeyUrl={customApiKeyUrl}
      readOnlyEndpoints={false}
      nameEditable
      onOpenPresetApiKey={
        customApiKeyUrl
          ? () => {
              onOpenApiKeyUrl(customApiKeyUrl);
            }
          : undefined
      }
    />
  );
}

// P3 C2 供应商套餐/计费面删除：CodingPlanPurchaseChoiceBanners 及其价格解析 helper
// （resolvePurchaseChoiceSelectionIntent / resolvePurchaseChoiceBannerProductsProviderId /
// resolvePurchaseChoiceBannerPrice / resolveEnterprisePurchaseChoiceBannerPrice /
// resolveStartPlanPurchaseChoiceBannerTitle / PurchaseChoiceBannerPrice）已随购买链路删除。

function CodingPlanAccessBanner({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-ui-base font-medium text-foreground">{title}</div>
      <p className="mt-1 text-ui-sm leading-6 text-foreground-subtle">{description}</p>
    </div>
  );
}

function resolveCodingPlanAccessBanner(
  status: CodingPlanStatus,
  intl: ReturnType<typeof useZCodeIntl>["intl"],
  reloginOnFailure = false,
): { title: string; description: string } | null {
  if (
    status !== "disconnected" &&
    status !== "notPurchased" &&
    !(status === "unavailable" && reloginOnFailure)
  ) {
    return null;
  }
  return {
    title: intl.formatMessage({
      id: `settings.modelProvider.codingPlan.status.${status}`,
    }),
    description: intl.formatMessage({
      id:
        status === "unavailable" && reloginOnFailure
          ? "settings.modelProvider.codingPlan.description.credentialFailed"
          : `settings.modelProvider.codingPlan.description.${status}`,
    }),
  };
}
