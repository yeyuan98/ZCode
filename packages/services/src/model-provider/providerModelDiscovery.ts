import { isApiKeyAccess, type ProviderSettingsTemplateView } from "@zcode/provider";

export interface DiscoverTemplateModelsInput {
  readonly templateId: string;
  /** 无 access 模板（如 ollama 本地端点）可不带 Key，走匿名发现。 */
  readonly apiKey?: string;
}

/** 端点自愿提供的每模型能力提示；仅在端点返回对应字段时存在（hints 不覆盖目录规则）。 */
export interface DiscoveryModelHints {
  /** anthropic `max_input_tokens` / openai-compat `context_length`，仅 >0 时有效。 */
  readonly contextWindow?: number;
  readonly supportsImage?: boolean;
  readonly supportsVideo?: boolean;
  readonly supportsPdf?: boolean;
}

export type DiscoverTemplateModelsResult =
  | {
      readonly ok: true;
      readonly modelIds: readonly string[];
      /** 按 id 附带的可选能力提示；端点不提供元数据时该字段整体缺省。 */
      readonly modelHints?: Readonly<Record<string, DiscoveryModelHints>>;
    }
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
  readonly firstId: string | undefined;
  readonly hints: ReadonlyMap<string, DiscoveryModelHints>;
}

/**
 * anthropic 形态元数据提取（仅规范 snake_case 字段）。probe 证据
 * （/tmp/opencode/bigmodel-probe.md）：bigmodel/zai 的 anthropic 镜像是 legacy 形状，
 * 完全没有 capabilities/max_input_tokens —— 该函数在这些镜像上是无操作（no-op），
 * 不解析任何 camelCase 能力拼写。
 */
function extractAnthropicModelHints(entry: object): DiscoveryModelHints | undefined {
  const raw = entry as {
    max_input_tokens?: unknown;
    capabilities?: {
      image_input?: { supported?: unknown } | null;
      pdf_input?: { supported?: unknown } | null;
    } | null;
  };
  let hints: DiscoveryModelHints | undefined;
  const maxInputTokens = raw.max_input_tokens;
  if (typeof maxInputTokens === "number" && maxInputTokens > 0) {
    hints = { contextWindow: maxInputTokens };
  }
  const capabilities = raw.capabilities;
  if (capabilities != null && typeof capabilities === "object") {
    if (capabilities.image_input?.supported === true) {
      hints = { ...hints, supportsImage: true };
    }
    if (capabilities.pdf_input?.supported === true) {
      hints = { ...hints, supportsPdf: true };
    }
  }
  return hints;
}

/**
 * openai-compat 形态元数据提取（OpenRouter 形状）。`input_modalities` 只认
 * image/video，audio/file 等未知模态忽略；openai-compat 端点没有 pdf 来源，
 * supportsPdf 保持缺省。
 */
function extractOpenaiModelHints(entry: object): DiscoveryModelHints | undefined {
  const raw = entry as {
    context_length?: unknown;
    architecture?: { input_modalities?: unknown } | null;
  };
  let hints: DiscoveryModelHints | undefined;
  const contextLength = raw.context_length;
  if (typeof contextLength === "number" && contextLength > 0) {
    hints = { contextWindow: contextLength };
  }
  const modalities = raw.architecture?.input_modalities;
  if (Array.isArray(modalities)) {
    if (modalities.includes("image")) {
      hints = { ...hints, supportsImage: true };
    }
    if (modalities.includes("video")) {
      hints = { ...hints, supportsVideo: true };
    }
  }
  return hints;
}

/**
 * 跨页/页内合并同 id 的 hints：后页字段只填补前页缺失的字段，绝不覆盖已有值
 * （0/null/缺省一律不产生字段），保证同一模型跨页出现时合并结果确定。
 */
function mergeDiscoveryModelHints(
  existing: DiscoveryModelHints | undefined,
  incoming: DiscoveryModelHints,
): DiscoveryModelHints {
  if (!existing) {
    return incoming;
  }
  const contextWindow = existing.contextWindow ?? incoming.contextWindow;
  const supportsImage = existing.supportsImage ?? incoming.supportsImage;
  const supportsVideo = existing.supportsVideo ?? incoming.supportsVideo;
  const supportsPdf = existing.supportsPdf ?? incoming.supportsPdf;
  // 只写入有值的字段，避免把显式 undefined 键泄漏进合并结果。
  const merged: {
    contextWindow?: number;
    supportsImage?: boolean;
    supportsVideo?: boolean;
    supportsPdf?: boolean;
  } = {};
  if (contextWindow !== undefined) {
    merged.contextWindow = contextWindow;
  }
  if (supportsImage !== undefined) {
    merged.supportsImage = supportsImage;
  }
  if (supportsVideo !== undefined) {
    merged.supportsVideo = supportsVideo;
  }
  if (supportsPdf !== undefined) {
    merged.supportsPdf = supportsPdf;
  }
  return merged;
}

function parseModelListPayload(
  payload: unknown,
  protocol: DiscoveryTarget["protocol"],
): ParsedModelList | null {
  if (payload == null || typeof payload !== "object") {
    return null;
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return null;
  }
  const ids: string[] = [];
  const hints = new Map<string, DiscoveryModelHints>();
  for (const entry of data) {
    const id = (entry as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !id) {
      continue;
    }
    ids.push(id);
    const hint =
      protocol === "anthropic"
        ? extractAnthropicModelHints(entry as object)
        : extractOpenaiModelHints(entry as object);
    if (hint) {
      hints.set(id, mergeDiscoveryModelHints(hints.get(id), hint));
    }
  }
  // probe 证据（/tmp/opencode/bigmodel-probe.md §Endpoint 3/§Paging check）：
  // bigmodel/zai 的 anthropic 镜像返回 camelCase 的 hasMore/firstId/lastId 分页字段
  // （非 Anthropic 规范的 snake_case 拼写）。两种拼写都接受；两者同时出现时
  // snake_case（规范拼写）优先。
  const cursor = payload as {
    has_more?: unknown;
    hasMore?: unknown;
    first_id?: unknown;
    firstId?: unknown;
    last_id?: unknown;
    lastId?: unknown;
  };
  const hasMoreRaw = cursor.has_more !== undefined ? cursor.has_more : cursor.hasMore;
  const firstIdRaw = cursor.first_id !== undefined ? cursor.first_id : cursor.firstId;
  const lastIdRaw = cursor.last_id !== undefined ? cursor.last_id : cursor.lastId;
  return {
    ids,
    hasMore: hasMoreRaw === true,
    firstId: typeof firstIdRaw === "string" && firstIdRaw ? firstIdRaw : undefined,
    lastId: typeof lastIdRaw === "string" && lastIdRaw ? lastIdRaw : undefined,
    hints,
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
  const modelHints = new Map<string, DiscoveryModelHints>();
  let firstSeenId: string | undefined;
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
    const parsed = parseModelListPayload(payload, target.protocol);
    if (!parsed) {
      return { ok: false, error: "invalid model list response" };
    }
    for (const id of parsed.ids) {
      uniqueIds.add(id);
    }
    for (const [id, hint] of parsed.hints) {
      modelHints.set(id, mergeDiscoveryModelHints(modelHints.get(id), hint));
    }
    const pageFirstId = parsed.firstId ?? parsed.ids[0];
    if (page === 0) {
      firstSeenId = pageFirstId;
    } else if (pageFirstId !== undefined && pageFirstId === firstSeenId) {
      // probe 证据（/tmp/opencode/bigmodel-probe.md §Paging check）：bigmodel/zai 的
      // anthropic 镜像声称支持游标分页却忽略 after_id，续拉时每次都从列表头重新返回。
      // 续拉页首条 id 与第 1 页首条 id 相同 ⇒ 判定镜像重启了列表，立即停止翻页并
      // 视作已拉全（去重保证无重复 id；10 页上限仍作异常兜底）。
      break;
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
  if (modelHints.size === 0) {
    return { ok: true, modelIds };
  }
  return { ok: true, modelIds, modelHints: Object.fromEntries(modelHints) };
}
