import type { ZCodeEnv } from "./env.js";

export const DEFAULT_ZCODE_ENDPOINT_ORIGIN = "https://zcode.z.ai";

// 构建仅注入公开链接；Node 调用方仍可显式传 env，避免读取另一进程的配置。
declare const __ZCODE_ENDPOINT_ENV__: Record<string, string | undefined> | undefined;
export function pickProductEndpointEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  // P3 C4 供应商 family/specs 删除：BIGMODEL_API_BASE_URL / ZAI_OAUTH_*（供应商 OAuth
  // 与 bigmodel API 端点 env）已随账号套餐链路移除，不再参与端点 env 挑选。
  const keys = ["ZCODE_BASE_URL", "ZCODE_ENDPOINT_ORIGIN"];
  return Object.fromEntries(
    keys.flatMap((key) => (env[key]?.trim() ? [[key, env[key]!.trim()]] : [])),
  );
}
export function readProductEndpointEnv(): Record<string, string | undefined> {
  return {
    ...(typeof __ZCODE_ENDPOINT_ENV__ === "undefined" ? {} : __ZCODE_ENDPOINT_ENV__),
    ...pickProductEndpointEnv(typeof process === "undefined" ? {} : process.env),
  };
}

export interface ZCodeEndpointUrls {
  origin: string;
  apiBaseUrl: string;
  webShareCallbackUrl: string;
}

export interface RuntimeZCodeEndpointEnv {
  [key: string]: string | undefined;
  ZCODE_ENV?: string;
  ZCODE_BASE_URL?: string;
  ZCODE_ENDPOINT_ORIGIN?: string;
}

// P3 C4 端点 trim（keep-list 生效）：ZAI OAuth 地址/ClientId 解析、bigmodel API
// origin/套餐管理页 builder、RuntimeBigModelApiEnv / RuntimeZaiEndpointEnv /
// RuntimeProductEndpointEnv 组合类型与 ZCodeEndpointUrls 的 zcodePlan* 计费字段
// 已随供应商账号链路移除；保留 ZCode 主端点解析与通用 URL 改写能力（P4/P5 前不变）。

function readRuntimeEnvValue(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function normalizeZCodeEndpointOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("ZCode endpoint origin is empty");
  }

  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("ZCode endpoint origin must use http or https");
  }
  return parsed.origin;
}

// P3 C2 供应商套餐/计费面删除：isTrustedCodingPlanWebviewOrigin（官网购买 webview 的
// origin 白名单）与 isLoopbackHostname（仅其 e2e 分支使用）已随购买链路移除。
export function resolveZCodeEndpointOrigin(options?: {
  env?: ZCodeEnv;
  envBaseOrigin?: string | null;
  overrideOrigin?: string | null;
}): string {
  const origin = options?.overrideOrigin?.trim() || options?.envBaseOrigin?.trim();
  return origin ? normalizeZCodeEndpointOrigin(origin) : DEFAULT_ZCODE_ENDPOINT_ORIGIN;
}

export function resolveRuntimeZCodeEnv(
  env: RuntimeZCodeEndpointEnv = readProductEndpointEnv(),
): ZCodeEnv {
  // 产品身份仅用于既有展示与安装标识，不参与地址解析。
  return env.ZCODE_ENV?.trim().toLowerCase() === "test" ? "test" : "production";
}

export function resolveRuntimeZCodeEndpointOrigin(
  env: RuntimeZCodeEndpointEnv = readProductEndpointEnv(),
  options?: { overrideOrigin?: string | null },
): string {
  return resolveZCodeEndpointOrigin({
    envBaseOrigin:
      readRuntimeEnvValue(env, "ZCODE_BASE_URL") ??
      readRuntimeEnvValue(env, "ZCODE_ENDPOINT_ORIGIN"),
    overrideOrigin: options?.overrideOrigin,
  });
}

export function buildRuntimeZCodeEndpointUrls(
  env: RuntimeZCodeEndpointEnv = readProductEndpointEnv(),
): ZCodeEndpointUrls {
  return buildZCodeEndpointUrls(resolveRuntimeZCodeEndpointOrigin(env));
}

export function buildRuntimeZCodeApiUrl(
  env: RuntimeZCodeEndpointEnv = readProductEndpointEnv(),
  path: string,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveRuntimeZCodeEndpointOrigin(env)}${normalizedPath}`;
}

export function buildZCodeEndpointUrls(origin: string): ZCodeEndpointUrls {
  const normalizedOrigin = normalizeZCodeEndpointOrigin(origin);
  return {
    origin: normalizedOrigin,
    apiBaseUrl: `${normalizedOrigin}/api/v1`,
    webShareCallbackUrl: `${normalizedOrigin}/cn/share/callback`,
  };
}

export function rewriteZCodeEndpointUrl(input: string | URL, endpointOrigin: string): string | URL {
  const originalUrl = typeof input === "string" ? input : input.toString();
  let parsed: URL;
  try {
    parsed = new URL(originalUrl);
  } catch {
    return input;
  }
  const sourceOrigin = DEFAULT_ZCODE_ENDPOINT_ORIGIN;
  if (parsed.origin !== sourceOrigin) {
    return input;
  }

  const targetOrigin = normalizeZCodeEndpointOrigin(endpointOrigin);
  if (targetOrigin === sourceOrigin) {
    return input;
  }

  const target = new URL(targetOrigin);
  target.pathname = parsed.pathname;
  target.search = parsed.search;
  target.hash = parsed.hash;
  return target.toString();
}
