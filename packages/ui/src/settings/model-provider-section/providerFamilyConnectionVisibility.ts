/* eslint-disable max-lines -- Settings 与输入框共用连接方式可见性规则，集中放置避免 Start/Coding/Team/API 条件漂移。 */
import type { ProviderFamilyDomain } from "@zcode/shared";
// P3 S2 过渡：vendor entitlement/quota 形状改自 UI 本地过渡模块（C4 de-plan 时移除）。
import type {
  UsageEntitlementSubscriptionDetail,
  UsageQuotaLimit,
} from "@/lib/usageQuotaShapes.js";
import {
  getModelProviderFamilySpec,
  isStartPlanModelProviderId,
  MODEL_PROVIDER_FAMILY_SPECS,
  resolveModelProviderFamilySpecByProviderId,
} from "@zcode/shared";
import { resolveMcpQuotaLimit } from "@/lib/codingPlanQuotaPresentation.js";
import { resolveUsageEntitlementOutcome } from "@/lib/codingPlanProvider.js";
import {
  type CodingPlanEntitlementState,
  type CodingPlanStatus,
  type ModelProviderNavGroup,
} from "@/settings/model-provider-section/constants.js";

type TeamPlanNavItem = Extract<ModelProviderNavGroup["items"][number], { type: "teamPlan" }>;

function createTeamPlanNavigationKey(
  family: ProviderFamilyDomain,
  input: { productId: string; organizationId: string; projectId: string },
): string {
  return ["team", family, input.productId, input.organizationId, input.projectId]
    .map(encodeURIComponent)
    .join(":");
}

interface ResolvedCodingPlanEntitlementState {
  statusLabelId?: string;
  status: CodingPlanStatus;
  planLevel: string | null;
  currentProductId: string | null;
  subscriptionBillingCycle: string | null;
  subscriptionRenewTime: string | null;
  subscriptionExpireTime: string | null;
  subscriptionDetails?: UsageEntitlementSubscriptionDetail[];
  quotaLimits: UsageQuotaLimit[];
  /**
   * 官方 Server MCP 额度（服务端下发的总额度）。它不在 quota.limits[] 里，只在有套餐快照的分支填充；
   * 其余分支保持缺省（等价于不展示），避免十余处早退分支都要跟着改。
   */
  mcpQuotaLimit?: UsageQuotaLimit | null;
}

export function resolveCodingPlanEntitlementState({
  providerId,
  accountEntitled,
  entitlement,
  modelProvidersLoading,
}: {
  providerId: string;
  /** 当前账号是否明确拥有该 Provider 对应的产品权益。 */
  accountEntitled: boolean;
  entitlement?: CodingPlanEntitlementState;
  modelProvidersLoading: boolean;
}): ResolvedCodingPlanEntitlementState {
  // Start 校验失败是未知，仍允许读取/重试，不能回退为未登录。
  // P2：accountState（availability/unavailableReason）已删除；可检视性只由账号权益集合决定。
  const canInspect = accountEntitled;
  if (!canInspect && modelProvidersLoading) {
    return {
      // 新 Host 启动时 Account Overlay 的首份 View 可能晚于旧
      // Provider 快照。该窗口必须保持 checking，不能读旧 Key，也不能提前判定断开。
      status: "checking",
      planLevel: null,
      currentProductId: null,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      quotaLimits: [],
    };
  }
  if (!canInspect) {
    // P2：Account Overlay 已删除；无账号权益时统一按未连接展示（P3 重建原因分流）。
    void providerId;
    return {
      // 套餐连接是 Account Overlay 事实，不是 Renderer 能读取的
      // API Key 事实。新 Host 明确传入 false 后，旧 Key 不得再点亮连接态。
      status: "disconnected",
      planLevel: null,
      currentProductId: null,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      quotaLimits: [],
    };
  }

  const snapshot = entitlement?.snapshot ?? null;
  if (entitlement?.loading && !snapshot?.subscription) {
    return {
      // refresh 会保留上一轮 snapshot；只有没有有效 subscription 时才显示 checking。
      status: "checking",
      planLevel: null,
      currentProductId: null,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      quotaLimits: [],
    };
  }

  if (!snapshot && entitlement?.error) {
    return {
      // 权益请求失败时必须退出 loading 态。
      status: "unavailable",
      planLevel: null,
      currentProductId: null,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      quotaLimits: [],
    };
  }

  const currentSubscription = snapshot?.subscription?.details[0] ?? null;
  const subscriptionDetails = snapshot?.subscription?.details ?? [];
  const currentProductId = currentSubscription?.productId ?? null;
  const planLevel =
    currentSubscription?.productName ?? snapshot?.quota?.level ?? currentProductId ?? null;
  const subscriptionBillingCycle = currentSubscription?.billingCycle ?? null;
  const subscriptionRenewTime = currentSubscription?.renewTime ?? null;
  const subscriptionExpireTime = currentSubscription?.expireTime ?? null;

  if (currentSubscription) {
    return {
      // Z.AI/BigModel 的真实套餐状态来自 subscription/list。
      status: "purchased",
      ...(entitlement?.error
        ? { statusLabelId: "settings.modelProvider.codingPlan.status.unavailable" }
        : {}),
      planLevel,
      currentProductId,
      subscriptionBillingCycle,
      subscriptionRenewTime,
      subscriptionExpireTime,
      subscriptionDetails,
      quotaLimits: snapshot?.quota?.limits ?? [],
      mcpQuotaLimit: resolveMcpQuotaLimit(snapshot),
    };
  }

  const entitlementOutcome = resolveUsageEntitlementOutcome(snapshot);
  if (entitlementOutcome === "inactive") {
    return {
      status: "notPurchased",
      ...(isStartPlanModelProviderId(providerId) && snapshot?.startPlanExpired
        ? { statusLabelId: "settings.modelProvider.startPlan.status.expired" }
        : {}),
      planLevel: null,
      currentProductId: null,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      quotaLimits: [],
    };
  }

  if (entitlementOutcome === "unknown") {
    return {
      // 过去把非 no_plan 的未知快照兜底成“未购买”，并让 entitlement
      // 越权裁决 Account 是否断开。账号已连接时，未知证据只能展示暂不可用。
      status: "unavailable",
      planLevel: null,
      currentProductId: null,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      quotaLimits: [],
    };
  }

  return {
    status: "purchased",
    ...(entitlement?.error
      ? { statusLabelId: "settings.modelProvider.codingPlan.status.unavailable" }
      : {}),
    planLevel,
    currentProductId,
    subscriptionBillingCycle,
    subscriptionRenewTime,
    subscriptionExpireTime,
    subscriptionDetails,
    quotaLimits: snapshot?.quota?.limits ?? [],
    mcpQuotaLimit: resolveMcpQuotaLimit(snapshot),
  };
}

export function buildVisibleFamilyConnectionItems({
  items,
  codingPlanEntitlements = {},
}: {
  items: Array<Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }>>;
  codingPlanEntitlements?: Partial<Record<string, CodingPlanEntitlementState>>;
}): ModelProviderNavGroup["items"] {
  // P1：连接选择（providerFamilyConnectionSelections）已删除，可见性不再参考已保存选择（P3 重建）。
  // P3 C2 供应商套餐/计费面删除：subscribedTeamProducts（企业定价目录驱动的 team 入口）
  // 已删除，团队入口只由 entitlement 快照派生。
  return appendSubscribedTeamPlanItems({
    items: filterStartPlanItemsByEntitlement({
      items,
      codingPlanEntitlements,
    }),
    codingPlanEntitlements,
  });
}

function filterStartPlanItemsByEntitlement({
  items,
  codingPlanEntitlements,
}: {
  items: Array<Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }>>;
  codingPlanEntitlements: Partial<Record<string, CodingPlanEntitlementState>>;
}): Array<Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }>> {
  // 原变量名 hasBigModelTeamPlan 暗示只服务 bigmodel，但逻辑本身是 family 无关的。
  // P3 C2：企业定价目录来源已删除，team 判定只剩 entitlement 快照。
  const hasAnyTeamPlan = hasEntitlementTeamPlan(codingPlanEntitlements);
  return items.filter((item) => {
    if (!isStartPlanModelProviderId(item.presetId)) {
      return true;
    }
    const familySpec = resolveModelProviderFamilySpecByProviderId(item.presetId);
    if (!familySpec) {
      return false;
    }
    const codingItem = items.find(
      (candidate) => candidate.presetId === familySpec.individualCodingPlanProviderId,
    );
    const hasStartPlanEntitlement = item.status === "purchased";
    const loggedIn =
      item.accountEntitled === true ||
      codingItem?.accountEntitled === true ||
      isResolvedEntitlementStatus(item.status) ||
      isResolvedEntitlementStatus(codingItem?.status ?? "disconnected") ||
      hasAnyTeamPlan;

    if (!loggedIn) {
      // 未登录时体验套餐只作为详情页引导入口，不作为连接方式。
      return false;
    }

    // Start Plan 是独立连接；个人/团队 Coding 权益不再参与可见性判断。
    // P1：已选连接不再保留查询中的入口，只有自身明确有权益才展示。
    return hasStartPlanEntitlement;
  });
}

/**
 * 按 family 查找对应 family 的 Coding Plan nav item。
 * 原 appendSubscribedTeamPlanItems 硬编码找 bigmodelCodingPlan，
 * zai team plan items 无对应展示基线。zai/bigmodel 对称化后，team item 的
 * providerName、provider 等展示字段应继承自所属 family 的 codingPlanItem。
 */
function resolveCodingPlanItemForFamily(
  items: Array<Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }>>,
  family: ProviderFamilyDomain,
): Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }> | undefined {
  const codingPlanProviderId = getModelProviderFamilySpec(family).individualCodingPlanProviderId;
  return items.find((item) => item.presetId === codingPlanProviderId);
}

function appendSubscribedTeamPlanItems({
  items,
  codingPlanEntitlements,
}: {
  items: Array<Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }>>;
  codingPlanEntitlements: Partial<Record<string, CodingPlanEntitlementState>>;
}): ModelProviderNavGroup["items"] {
  // 原实现先 items.find(bigmodelCodingPlan)，不存在时直接 return items。
  // 当设置页只展示 zai family（providerFamilyDomain === "zai"）时，codingPlanItems 里
  // 没有 bigmodelCodingPlan，这个守卫会让 appendSubscribedTeamPlanItems 整体短路，
  // zai teamPlan item 永远不生成 → pickFamilyModeNavigationItem 找不到 saved team item
  // → selectedNavItem=null → 右侧 Plan Card 永远卡在 "加载中"。
  // 对称化：去掉 bigmodel 硬编码前置守卫，entitlement builder 按 family 解析对应
  // codingPlanItem，不存在就跳过该 family。
  // P3 C2 供应商套餐/计费面删除：企业定价目录（subscribedTeamProducts）驱动的
  // product team items 与名称/状态校正已移除，team 入口只由 entitlement 快照派生。
  const entitlementTeamItems: TeamPlanNavItem[] = MODEL_PROVIDER_FAMILY_SPECS.flatMap(
    ({ id: family }) => {
      const codingPlanItem = resolveCodingPlanItemForFamily(items, family);
      if (!codingPlanItem) {
        return [];
      }
      return buildEntitlementTeamPlanItems(codingPlanItem, codingPlanEntitlements, family);
    },
  );

  const teamItems: ModelProviderNavGroup["items"] = entitlementTeamItems;

  if (teamItems.length === 0) {
    return items;
  }

  // 原写法硬编码 items.findIndex(bigmodelCodingPlanItem.key) 作为插入点，
  // zai-only 视图下 bigmodelCodingPlanItem 不存在会 throw（.key 访问 undefined）。
  // 改为按首个 team item 所属 family 找对应 codingPlanItem 作为插入锚点；
  // 找不到就追加到末尾（与原 fallback 语义一致）。
  const firstTeamFamily = resolveModelProviderFamilySpecByProviderId(
    (teamItems[0] as TeamPlanNavItem | undefined)?.presetId ?? "",
  )?.id;
  const anchorCodingPlanItem = firstTeamFamily
    ? resolveCodingPlanItemForFamily(items, firstTeamFamily)
    : undefined;
  const codingPlanIndex = anchorCodingPlanItem
    ? items.findIndex((item) => item.key === anchorCodingPlanItem.key)
    : -1;
  if (codingPlanIndex < 0) {
    return [...items, ...teamItems];
  }
  return [
    ...items.slice(0, codingPlanIndex + 1),
    ...teamItems,
    ...items.slice(codingPlanIndex + 1),
  ];
}

function hasEntitlementTeamPlan(
  codingPlanEntitlements: Partial<Record<string, CodingPlanEntitlementState>>,
): boolean {
  return Object.values(codingPlanEntitlements).some(
    (entitlement) =>
      entitlement?.snapshot?.context?.scope === "team" &&
      Boolean(entitlement.snapshot.context.organizationId?.trim()) &&
      Boolean(entitlement.snapshot.context.projectId?.trim()),
  );
}

function buildEntitlementTeamPlanItems(
  codingPlanItem: Extract<ModelProviderNavGroup["items"][number], { type: "codingPlan" }>,
  codingPlanEntitlements: Partial<Record<string, CodingPlanEntitlementState>>,
  family: ProviderFamilyDomain,
): TeamPlanNavItem[] {
  // 原硬编码读 bigmodelCodingPlan bucket + bigmodel team key。
  // zai/bigmodel 对称化后，按 family 读对应 codingPlan bucket、生成对应前缀 team key。
  const familySpec = getModelProviderFamilySpec(family);
  const codingPlanProviderId = familySpec.teamCodingPlanProviderId;
  const entitlement = codingPlanEntitlements[codingPlanProviderId];
  if (!entitlement) {
    return [];
  }
  const snapshot = entitlement.snapshot ?? null;
  if (snapshot?.context?.scope !== "team") {
    return [];
  }
  const organizationId = snapshot.context.organizationId?.trim() ?? "";
  const projectId = snapshot.context.projectId?.trim() ?? "";
  if (!organizationId || !projectId) {
    return [];
  }
  const currentSubscription = snapshot.subscription?.details[0] ?? null;
  const productId =
    snapshot.context.productId?.trim() ||
    currentSubscription?.productId?.trim() ||
    codingPlanItem.currentProductId?.trim() ||
    "current";
  const teamPlanName =
    snapshot.context.displayName?.trim() ||
    currentSubscription?.productName?.trim() ||
    codingPlanItem.planLevel?.trim() ||
    "Team";
  return [
    {
      ...codingPlanItem,
      key: createTeamPlanNavigationKey(family, {
        productId,
        organizationId,
        projectId,
      }),
      presetId: codingPlanProviderId,
      type: "teamPlan" as const,
      label: `${codingPlanItem.providerName} - ${teamPlanName}`,
      teamPlanName,
      organizationId,
      projectId,
      status: "purchased" as const,
      // Team Plan 连接项先以 entitlement snapshot 为主数据源。
      // enterprise pricing/customerInfo 只负责后续校正名称和商品字段，不能让连接方式退回 Coding Plan。
      planLevel: teamPlanName,
      currentProductId: productId,
      purchaseUrl: familySpec.teamCodingPlanManageUrl,
      subscriptionBillingCycle: null,
      subscriptionRenewTime: null,
      subscriptionExpireTime: null,
      statusActive: true,
    },
  ];
}

// P3 C2：isTeamPlanQuotaUnavailable / resolveTeamPlanProjectKey 仅服务企业定价目录
// 驱动的 product team items 校正，已随该分支移除。

function isResolvedEntitlementStatus(status: CodingPlanStatus): boolean {
  return status !== "checking" && status !== "disconnected";
}
