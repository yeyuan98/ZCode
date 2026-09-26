import type { ProviderSettingsTemplateView } from "@zcode/provider";

export interface ProbeTemplateApiKeyInput {
  readonly templateId: string;
  readonly apiKey: string;
}

export type ProbeTemplateApiKeyResult =
  | { readonly ok: true; readonly modelCount: number }
  | { readonly ok: false; readonly error: string };

export type ProbeTemplateApiKeyFetch = typeof fetch;

const PROBE_TIMEOUT_MS = 15_000;

interface ProbeTarget {
  readonly protocol: "anthropic" | "openai";
  readonly modelsUrl: string;
}

/**
 * 解析模板的探测目标；仅支持 plain api-key access 且带 api.baseUrl 的模板。
 * 内置模板的 baseUrl 有的已含版本段（如 https://api.openai.com/v1、.../api/paas/v4），
 * 拼接 /v1/models 前先去掉重复版本段，保证探测 URL 与真实模型列表端点一致。
 */
function resolveTemplateApiKeyProbeTarget(
  template: ProviderSettingsTemplateView | undefined,
): ProbeTarget | null {
  if (!template || template.config.access?.type !== "api-key") {
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

/**
 * 直接 HTTP 探测模板 API Key（GET {baseUrl}/models）。
 * A2 用直接 HTTP 探测（P1 的模型发现客户端将取代它）；失败仅作提示，不阻塞保存。
 */
export async function probeTemplateApiKey(
  input: ProbeTemplateApiKeyInput,
  dependencies: {
    readonly fetch: ProbeTemplateApiKeyFetch;
    readonly template: ProviderSettingsTemplateView | undefined;
  },
): Promise<ProbeTemplateApiKeyResult> {
  const target = resolveTemplateApiKeyProbeTarget(dependencies.template);
  if (!target) {
    return { ok: false, error: "unsupported template" };
  }

  const headers: Record<string, string> =
    target.protocol === "anthropic"
      ? {
          "x-api-key": input.apiKey,
          "anthropic-version": "2023-06-01",
        }
      : { Authorization: `Bearer ${input.apiKey}` };

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await dependencies.fetch(target.modelsUrl, {
      headers,
      signal: abortController.signal,
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} ${response.statusText}`.trim() };
    }
    const payload: unknown = await response.json().catch(() => null);
    const data = (payload as { data?: unknown } | null)?.data;
    const modelCount = Array.isArray(data) ? data.length : 0;
    return { ok: true, modelCount };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? `HTTP timeout after ${PROBE_TIMEOUT_MS / 1000}s`
          : error.message
        : String(error);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
