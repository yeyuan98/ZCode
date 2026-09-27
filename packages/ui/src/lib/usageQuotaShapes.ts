/**
 * P3 供应商套餐/配额面删除（S2 过渡类型，勿新增消费方）：
 * shared 的 vendor 半边（usage-stats.ts entitlement 类型 + usage-quota.ts 全部额度类型）
 * 已随 usage 服务的套餐/配额方法一并删除。设置页 model-provider-section 的套餐状态卡
 * 仍引用这些纯展示形状，先在 UI 本地保留一份等价定义；C4 设置页 de-plan 时随
 * StatusCards / constants / codingPlanQuotaPresentation 等整体移除。
 */

export interface UsageQuotaUsageDetail {
  modelCode: string;
  displayName?: string;
  usage: number;
}

export interface UsageQuotaLimit {
  type: string;
  /** Start Plan 服务端额度桶及周期身份；周期时间为毫秒，供提醒去重。 */
  bucketId?: string;
  userPlanId?: string;
  periodStart?: number;
  periodEnd?: number;
  /** 所属 entitlement 的周期类型，如 daily / one_time。 */
  period?: string;
  meter?: string;
  unitType?: string;
  /** Start Plan bucket 所属套餐身份，仅用于设置页按 plan 分组展示。 */
  planId?: string;
  unit?: number;
  number?: number;
  usage?: number;
  currentValue?: number;
  remaining?: number;
  percentage?: number;
  nextResetTime?: number;
  usageDetails: UsageQuotaUsageDetail[];
}

export interface UsageQuotaSnapshot {
  level: string | null;
  limits: UsageQuotaLimit[];
}

/** MCP 额度所属的 Coding Plan 连接，供 UI 判断能否显示在当前 provider tab 下。 */
export type UsageMcpQuotaScope =
  | {
      providerFamily: "zai" | "bigmodel";
      targetType: "PERSONAL";
    }
  | {
      providerFamily: "zai" | "bigmodel";
      targetType: "TEAM";
      organizationId: string;
      projectId: string;
    };

export interface UsageMcpQuotaSnapshot {
  /** 服务端 server_time，毫秒（接口返回 Unix 秒）。 */
  serverTime: number;
  level: string | null;
  scope: UsageMcpQuotaScope;
  /**
   * 服务端 `total_usage`（总已用 / 总额度 / 总剩余）的等价表达，直接复用现有额度条 / 额度卡的
   * 展示逻辑。注意 percentage 沿用 quota 接口口径：**已使用占比**，展示端负责反转成剩余。
   */
  aggregate: UsageQuotaLimit;
}

export interface UsageEntitlementProviderInfo {
  id: string;
  name: string;
}

export interface UsageEntitlementContext {
  scope: "personal" | "team";
  organizationId?: string | null;
  projectId?: string | null;
  displayName?: string | null;
  productId?: string | null;
}

export interface UsageEntitlementRemaining {
  count: number;
  isShow: boolean;
  percentage?: number;
  nextResetTime?: number | null;
}

export interface UsageEntitlementSubscriptionDetail {
  productId: string;
  productName: string;
  purchaseTime: string | null;
  beginTime: string | null;
  billingCycle?: string | null;
  renewTime?: string | null;
  expireTime: string | null;
  /** Start Plan balance 套餐下的权益生效时间；其他订阅类型可不提供。 */
  entitlements?: Array<{
    entitlementId: string;
    /** 服务端 entitlement show_name，用于待生效提示。 */
    showName?: string | null;
    effectiveTime: string | null;
  }>;
}

export interface UsageEntitlementSubscription {
  identityType: "email" | "phoneNumber" | "unknown";
  identityMasked: string | null;
  details: UsageEntitlementSubscriptionDetail[];
}

export interface UsageEntitlementSnapshot {
  generatedAt: number;
  /** 当前额度响应的服务端时间（毫秒）；与本地快照生成时间 generatedAt 分离。 */
  serverTime?: number;
  authenticated: boolean;
  unavailableReason?: "not_authenticated" | "not_configured" | "no_plan" | "unavailable";
  /** 无可用 Start Plan 时，保留明确过期原因用于展示。 */
  startPlanExpired?: boolean;
  /** 团队订阅明确失效的原因，仅与 no_plan 一起返回。 */
  teamPlanUnavailableReason?: "expired" | "unassigned";
  /** 当前 entitlement 查询对应的个人 / 团队上下文，用于设置页连接方式主判定。 */
  context?: UsageEntitlementContext | null;
  /** 当前用于查询 quota 的模型供应商信息。 */
  provider: UsageEntitlementProviderInfo | null;
  remaining: UsageEntitlementRemaining | null;
  subscription: UsageEntitlementSubscription | null;
  quota: UsageQuotaSnapshot | null;
  /**
   * ZCode 官方 Server MCP 的调用额度（`/api/v1/mcp/usage`）。
   * 拉取失败、未开通 Coding Plan、或该额度不属于本次查询的连接时一律为 null（可选数据面）。
   */
  mcpQuota?: UsageMcpQuotaSnapshot | null;
}
