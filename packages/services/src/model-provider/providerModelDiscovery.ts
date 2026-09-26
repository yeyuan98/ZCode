import { isApiKeyAccess, type ProviderSettingsTemplateView } from "@zcode/provider";

export interface DiscoverTemplateModelsInput {
  readonly templateId: string;
  /** 无 access 模板（如 ollama 本地端点）可不带 Key，走匿名发现。 */
  readonly apiKey?: string;
}

export type DiscoverTemplateModelsResult =
  | { readonly ok: true; readonly modelIds: readonly string[] }
  | { readonly ok: false; readonly error: string };

export type DiscoverTemplateModelsFetch = typeof fetch;

const DISCOVERY_TIMEOUT_MS = 15_000;
/** anthropic 游标翻页上限：远端 has_more 异常时不能无限拉取。 */
const ANTHROPIC_MAX_PAGES = 10;

interface DiscoveryTarget {
  readonly protocol: "anthropic" | "openai";
  readonly modelsUrl: string;
}

/**
 * 解析模板的发现目标；支持无 access（本地 ollama）与 plain api-key 且带 api.baseUrl 的模板。
 * 内置模板的 baseUrl 有的已含版本段（如 https://api.openai.com/v1、.../api/paas/v4），
 * 拼接 models 前先去掉重复版本段，保证发现 URL 与真实模型列表端点一致。
 */
function resolveTemplateModelDiscoveryTarget(
  template: ProviderSettingsTemplateView | undefined,
): DiscoveryTarget | null {
  if (!template) {
    return null;
  }
  const access = template.config.access;
  if (access != null && !isApiKeyAccess(access)) {
    return null;
  }
  const api = template.config.api;
  if (!api?.baseUrl) {
    return null;
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(api.baseUrl);
  } catch {
    return null;
  }
  const versionedPath = /\/v\d+\/?$/.test(baseUrl.pathname);
  if (!versionedPath && !baseUrl.pathname.endsWith("/")) {
    baseUrl.pathname += "/";
  }
  baseUrl.pathname = versionedPath
    ? `${baseUrl.pathname.replace(/\/+$/, "")}/models`
    : `${baseUrl.pathname}v1/models`;
  const protocol = api.type === "anthropic-messages" ? "anthropic" : "openai";
  return { protocol, modelsUrl: baseUrl.toString() };
}

interface ParsedModelList {
  readonly ids: readonly string[];
  readonly hasMore: boolean;
  readonly lastId: string | undefined;
}

function parseModelListPayload(payload: unknown): ParsedModelList | null {
  if (payload == null || typeof payload !== "object") {
    return null;
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return null;
  }
  const ids: string[] = [];
  for (const entry of data) {
    const id = (entry as { id?: unknown } | null)?.id;
    if (typeof id === "string") {
      ids.push(id);
    }
  }
  const cursor = payload as { has_more?: unknown; last_id?: unknown };
  return {
    ids,
    hasMore: cursor.has_more === true,
    lastId: typeof cursor.last_id === "string" ? cursor.last_id : undefined,
  };
}

/**
 * 直接 HTTP 发现模板可用模型列表（openai: GET {baseUrl}/models；anthropic:
 * GET {baseUrl}/v1/models + after_id 游标翻页）。P1 吸收 A2 的“测试 Key”探测：
 * 仍走 Host 网络 transport、不启动 agent runtime；失败仅作提示，不阻塞保存。
 */
export async function discoverTemplateModels(
  input: DiscoverTemplateModelsInput,
  dependencies: {
    readonly fetch: DiscoverTemplateModelsFetch;
    readonly template: ProviderSettingsTemplateView | undefined;
  },
): Promise<DiscoverTemplateModelsResult> {
  const target = resolveTemplateModelDiscoveryTarget(dependencies.template);
  if (!target) {
    return { ok: false, error: "unsupported template" };
  }

  const apiKey = input.apiKey?.trim() ?? "";
  const headers: Record<string, string> =
    target.protocol === "anthropic"
      ? {
          "anthropic-version": "2023-06-01",
          // ollama 等无 Key 端点不接受伪造鉴权头；仅在 Key 非空时携带。
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        }
      : apiKey
        ? { Authorization: `Bearer ${apiKey}` }
        : {};

  const requestUrl = new URL(target.modelsUrl);
  const uniqueIds = new Set<string>();
  for (let page = 0; ; page += 1) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), DISCOVERY_TIMEOUT_MS);
    let payload: unknown;
    try {
      const response = await dependencies.fetch(requestUrl, {
        headers,
        signal: abortController.signal,
      });
      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status} ${response.statusText}`.trim() };
      }
      payload = await response.json().catch(() => null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.name === "AbortError"
            ? `HTTP timeout after ${DISCOVERY_TIMEOUT_MS / 1000}s`
            : error.message
          : String(error);
      return { ok: false, error: message };
    } finally {
      clearTimeout(timeout);
    }
    const parsed = parseModelListPayload(payload);
    if (!parsed) {
      return { ok: false, error: "invalid model list response" };
    }
    for (const id of parsed.ids) {
      if (id) {
        uniqueIds.add(id);
      }
    }
    // anthropic 游标翻页：has_more + last_id 驱动 after_id 续拉；openai 忽略游标字段。
    if (
      target.protocol !== "anthropic" ||
      !parsed.hasMore ||
      !parsed.lastId ||
      page + 1 >= ANTHROPIC_MAX_PAGES
    ) {
      break;
    }
    requestUrl.searchParams.set("after_id", parsed.lastId);
  }
  const modelIds = [...uniqueIds].sort();
  // spec：空模型列表按失败降级（"works · 0 models" 会误导用户保存零模型 provider，
  // 下次启动向导必然重开）；key 本身有效与否此时不可判，统一走失败态允许继续保存。
  if (modelIds.length === 0) {
    return { ok: false, error: "no models returned" };
  }
  return { ok: true, modelIds };
}
