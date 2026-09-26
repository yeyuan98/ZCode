/* eslint-disable max-lines -- Coding Plan 登录、订阅与 Start/Coding 互斥校验需要集中维护，拆散会让系统禁用原因更难追踪。 */
import {
  ApiError,
  buildBigModelApiUrl,
  buildRuntimeZaiBusinessUrl,
  type ApiClient,
  type ProviderFamilyDomain,
} from "@zcode/shared";
import { fetchPersonalCodingPlanEntitlement } from "#src/bigmodel/codingPlanEntitlement.js";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { normalizeApiKeyForHeader } from "../providers/api/index.js";
import { resolveBigModelStartPlanZcodeJwt } from "./bigmodelStartPlanZcodeJwt.js";
import {
  buildZaiStartPlanBalanceUrl,
  fetchZaiStartPlanBalanceEnvelope,
  resolveZaiStartPlanBalanceModelIds,
  type ZaiStartPlanBalanceEnvelope,
} from "./zaiStartPlanBilling.js";

const REQUEST_TIMEOUT_MS = 15_000;
const log = createServiceLogger("coding-plan-availability");
const BIGMODEL_SUBSCRIPTION_LIST_PATH = "/api/biz/subscription/list";

const ZCODE_JWT_TOKEN_KEY = "zcodejwttoken";

export type CodingPlanUnavailableReason =
  | "coding_plan_not_authenticated"
  | "coding_plan_not_connected"
  | "coding_plan_auth_failed"
  | "coding_plan_not_entitled";

function buildZaiSubscriptionListUrl(): string {
  // ZAI 测试环境业务 token 只能请求配置的 ZAI Business origin。
  // availability 校验必须和 OAuth business login 共用同一套 ZCODE_ENV 域名分流，只允许 origin 不同。
  return buildRuntimeZaiBusinessUrl(process.env, "/api/biz/subscription/list");
}

interface CodingPlanAvailabilityCredentialService {
  load(key: string): Promise<string | null>;
}

interface CodingPlanAvailabilityContext {
  apiClient?: ApiClient;
  credentialService?: CodingPlanAvailabilityCredentialService;
}

interface ZaiStartPlanPlan {
  plan_id?: string | null;
  name?: string | null;
  status?: string | null;
  starts_at?: number | string | null;
  ends_at?: number | string | null;
  entitlements?: Array<{
    period?: string | null;
  }>;
}

export type CodingPlanAvailabilityResult =
  | { kind: "available"; models?: readonly string[] }
  | { kind: "pending"; effectiveAt: number; models: readonly string[] }
  | { kind: "unavailable"; reason: CodingPlanUnavailableReason }
  | { kind: "unknown" };

export interface CodingPlanAvailabilityProvider {
  readonly providerId: string;
  readonly family: ProviderFamilyDomain;
  readonly planKind: "start-plan" | "individual-coding-plan" | "team-coding-plan";
  readonly apiKey?: string | null;
}

async function validateCodingPlanProviderAvailability(
  provider: CodingPlanAvailabilityProvider,
  context: CodingPlanAvailabilityContext,
): Promise<CodingPlanAvailabilityResult> {
  if (!context.apiClient) {
    return { kind: "unknown" };
  }

  if (provider.planKind === "start-plan") {
    return validateStartPlanAvailability(provider, context);
  }

  if (provider.planKind !== "individual-coding-plan") {
    return { kind: "unknown" };
  }

  if (provider.family === "zai") {
    return validateSubscriptionListAvailability(provider, context, buildZaiSubscriptionListUrl());
  }

  return validateSubscriptionListAvailability(
    provider,
    context,
    buildBigModelApiUrl(process.env, BIGMODEL_SUBSCRIPTION_LIST_PATH),
  );
}

export async function validateZaiAccountProviderAvailability(
  providers: readonly CodingPlanAvailabilityProvider[],
  context: CodingPlanAvailabilityContext,
): Promise<Partial<Record<string, CodingPlanAvailabilityResult>>> {
  const startProvider = findAvailabilityProvider(providers, "zai", "start-plan");
  const individualProvider = findAvailabilityProvider(providers, "zai", "individual-coding-plan");
  const teamProvider = findAvailabilityProvider(providers, "zai", "team-coding-plan");
  return validateFamilyAccountProviders({
    family: "zai",
    context,
    startProvider,
    individualProvider,
    teamProvider,
  });
}

export async function validateBigModelAccountProviderAvailability(
  providers: readonly CodingPlanAvailabilityProvider[],
  context: CodingPlanAvailabilityContext,
): Promise<Partial<Record<string, CodingPlanAvailabilityResult>>> {
  const startProvider = findAvailabilityProvider(providers, "bigmodel", "start-plan");
  const individualProvider = findAvailabilityProvider(
    providers,
    "bigmodel",
    "individual-coding-plan",
  );
  const teamProvider = findAvailabilityProvider(providers, "bigmodel", "team-coding-plan");
  return validateFamilyAccountProviders({
    family: "bigmodel",
    context,
    startProvider,
    individualProvider,
    teamProvider,
  });
}

function findAvailabilityProvider(
  providers: readonly CodingPlanAvailabilityProvider[],
  family: ProviderFamilyDomain,
  planKind: CodingPlanAvailabilityProvider["planKind"],
): CodingPlanAvailabilityProvider | undefined {
  return providers.find((provider) => provider.family === family && provider.planKind === planKind);
}

async function validateFamilyAccountProviders(params: {
  family: ProviderFamilyDomain;
  context: CodingPlanAvailabilityContext;
  startProvider?: CodingPlanAvailabilityProvider;
  individualProvider?: CodingPlanAvailabilityProvider;
  teamProvider?: CodingPlanAvailabilityProvider;
}): Promise<Partial<Record<string, CodingPlanAvailabilityResult>>> {
  const unavailable = {
    kind: "unavailable" as const,
    reason: "coding_plan_not_connected" as const,
  };
  const result: Record<string, CodingPlanAvailabilityResult> = {};
  for (const provider of [params.startProvider, params.individualProvider, params.teamProvider]) {
    if (provider) result[provider.providerId] = unavailable;
  }

  // Start Plan 是独立权益：即使当前连接仍是个人/Team Coding Plan，也必须单独查询，
  // 否则领取后待生效或已拥有的 Start Plan 会被错误地当成“未连接”，设置页无法展示。
  if (params.startProvider) {
    result[params.startProvider.providerId] = await validateStartPlanAvailability(
      params.startProvider,
      params.context,
    );
  }
  // 个人订阅和 Start 独立查询，不以当前选中状态代替权益。
  if (params.individualProvider) {
    result[params.individualProvider.providerId] = await validateCodingPlanProviderAvailability(
      params.individualProvider,
      params.context,
    );
  }
  // P1：providerFamilyConnectionSelections 已删除，Team 失去选中项目身份，只能落到 unknown（P3 重建）。
  if (params.teamProvider) {
    result[params.teamProvider.providerId] = { kind: "unknown" };
  }
  return result;
}

async function validateSubscriptionListAvailability(
  provider: CodingPlanAvailabilityProvider,
  context: CodingPlanAvailabilityContext,
  url: string,
): Promise<CodingPlanAvailabilityResult> {
  const authorization = normalizeApiKeyForHeader(provider.apiKey ?? "");
  // Key 尚未准备好只能表示权益未知；不能用调用凭据的缺失证明未订阅。
  if (!authorization) return { kind: "unknown" };
  try {
    const result = await fetchPersonalCodingPlanEntitlement({
      apiClient: context.apiClient!,
      authorization,
      url,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    return result.kind === "unavailable"
      ? { kind: "unavailable", reason: "coding_plan_not_entitled" }
      : { kind: result.kind };
  } catch (error) {
    return classifyAvailabilityError(error);
  }
}

interface StartPlanAuthorization {
  value: string;
  missingReason: CodingPlanUnavailableReason;
}

async function validateStartPlanAvailability(
  provider: CodingPlanAvailabilityProvider,
  context: CodingPlanAvailabilityContext,
): Promise<CodingPlanAvailabilityResult> {
  const authorization = await resolveStartPlanAuthorization(provider, context);
  if (!authorization.value) {
    return {
      kind: "unavailable",
      reason: authorization.missingReason,
    };
  }

  try {
    const startedAt = Date.now();
    // billing/current 已废弃，balance 的 data.plans 是 Start Plan 可用性权威来源。
    // availability 只请求一次 balance，避免冷启动在入口校验阶段重复打旧 current 接口。
    const payload = await fetchZaiStartPlanBalanceEnvelope(context.apiClient!, authorization.value);
    const activeStartPlan = hasActiveStartPlan(payload.data?.plans);
    log.info(undefined, "billing/balance 请求完成", {
      durationMs: Date.now() - startedAt,
      hasActiveStartPlan: activeStartPlan,
      msg: payload.msg ?? null,
      payload,
      planCount: payload.data?.plans?.length ?? 0,
      plans: summarizeStartPlans(payload.data?.plans),
      providerId: provider.providerId,
      success: isSuccessfulBusinessEnvelope(payload),
      url: buildZaiStartPlanBalanceUrl(),
      code: payload.code ?? null,
    });
    return resolveStartPlanBalanceAvailability(payload);
  } catch (error) {
    log.warn(undefined, "billing/balance 请求失败", {
      error: error instanceof Error ? error.message : String(error),
      providerId: provider.providerId,
      responseHeaders: error instanceof ApiError ? (error.responseHeaders ?? null) : null,
      status: error instanceof ApiError ? error.status : null,
      url: buildZaiStartPlanBalanceUrl(),
    });
    return classifyAvailabilityError(error);
  }
}

async function resolveStartPlanAuthorization(
  provider: CodingPlanAvailabilityProvider,
  context: CodingPlanAvailabilityContext,
): Promise<StartPlanAuthorization> {
  if (provider.family === "bigmodel") {
    const zcodeJwtToken = await resolveBigModelStartPlanZcodeJwt({
      credentialService: context.credentialService,
      provider,
    });
    return {
      value: zcodeJwtToken ? `Bearer ${zcodeJwtToken}` : "",
      missingReason: "coding_plan_not_authenticated",
    };
  }

  const credentialJwt = await loadZaiProviderConnectionZcodeJwtToken(context);
  const providerJwt = normalizeApiKeyForHeader(provider.apiKey ?? "");
  return {
    value: credentialJwt || providerJwt ? `Bearer ${credentialJwt || providerJwt}` : "",
    missingReason: "coding_plan_not_authenticated",
  };
}

function resolveStartPlanBalanceAvailability(
  payload: ZaiStartPlanBalanceEnvelope,
): CodingPlanAvailabilityResult {
  if (!isSuccessfulBusinessEnvelope(payload)) {
    return { kind: "unavailable", reason: "coding_plan_auth_failed" };
  }
  if (!hasActiveStartPlan(payload.data?.plans)) {
    return { kind: "unavailable", reason: "coding_plan_not_entitled" };
  }
  const models = resolveZaiStartPlanBalanceModelIds(payload);
  const serverTime = payload.data?.server_time;
  const nowSeconds =
    typeof serverTime === "number" && Number.isFinite(serverTime) && serverTime >= 0
      ? serverTime
      : Date.now() / 1000;
  const effectiveTimes = (payload.data?.plans ?? [])
    .filter((plan) => plan.status?.toLowerCase() === "active")
    .flatMap((plan) =>
      plan.entitlements?.length
        ? plan.entitlements.map((entry) => entry.effective_at)
        : [plan.starts_at],
    )
    .map((value) =>
      value === null || value === undefined || value === "" ? undefined : Number(value),
    );
  // 只有明确所有权益都在未来才标 pending；缺失时间不伪造日期，模型仍由余额白名单决定。
  if (
    models.length === 0 &&
    effectiveTimes.length > 0 &&
    effectiveTimes.every(
      (value) => value !== undefined && Number.isFinite(value) && value > nowSeconds,
    )
  ) {
    return {
      kind: "pending",
      effectiveAt: Math.min(...(effectiveTimes as number[])),
      models: [],
    };
  }
  return models.length > 0
    ? { kind: "available", models: Object.freeze(models) }
    : { kind: "available" };
}

async function loadZaiProviderConnectionZcodeJwtToken(
  context: CodingPlanAvailabilityContext,
): Promise<string> {
  return (await context.credentialService?.load(ZCODE_JWT_TOKEN_KEY))?.trim() || "";
}

function classifyAvailabilityError(error: unknown): CodingPlanAvailabilityResult {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return { kind: "unavailable", reason: "coding_plan_auth_failed" };
  }
  return { kind: "unknown" };
}

function isSuccessfulBusinessEnvelope(payload: { code?: number; success?: boolean }): boolean {
  return (
    payload.success !== false &&
    (payload.code === undefined || payload.code === 0 || payload.code === 200)
  );
}

function hasActiveStartPlan(plans: ZaiStartPlanPlan[] | undefined): boolean {
  return Boolean(
    plans?.some((plan) => {
      const status = plan.status?.trim().toLowerCase();
      const planId = plan.plan_id?.trim().toLowerCase();
      const name = plan.name?.trim().toLowerCase();
      // billing/balance 的 plans 真实返回的是 `plan_id=zcode-v3-start-plan`
      // 和 `name=ZCode V3 Start Plan`；只认 `name === "start plan"` 的话，
      // 已激活的 Start Plan 会被误写成 coding_plan_not_entitled。
      const identityMatches =
        !planId && !name ? true : isZaiStartPlanIdentity(planId) || isZaiStartPlanIdentity(name);
      return status === "active" && identityMatches;
    }),
  );
}

function isZaiStartPlanIdentity(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return value.includes("start-plan") || value.includes("start plan");
}

function summarizeStartPlans(
  plans: ZaiStartPlanPlan[] | undefined,
): Array<Pick<ZaiStartPlanPlan, "name" | "plan_id" | "status">> {
  return (plans ?? []).map((plan) => ({
    name: plan.name ?? null,
    plan_id: plan.plan_id ?? null,
    status: plan.status ?? null,
  }));
}
