import type { Locale } from "./protocol.js";

interface RemoteAppConfigLike {
  feedback_url?: unknown;
  community_urls?: unknown;
}

type LocaleUrlMap = Partial<Record<Locale, string>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}

function sanitizeUrl(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function getFeedbackUrlFromConfig(config: unknown): string | undefined {
  if (!isRecord(config)) {
    return undefined;
  }

  return sanitizeUrl((config as RemoteAppConfigLike).feedback_url);
}

export function getCommunityUrlsFromConfig(config: unknown): LocaleUrlMap {
  if (!isRecord(config)) {
    return {};
  }

  const rawCommunityUrls = (config as RemoteAppConfigLike).community_urls;
  if (!isRecord(rawCommunityUrls)) {
    return {};
  }

  return {
    "zh-CN": sanitizeUrl(rawCommunityUrls["zh-CN"]),
    "en-US": sanitizeUrl(rawCommunityUrls["en-US"]),
  };
}

export function getCommunityUrlFromConfig(config: unknown, locale: Locale): string | undefined {
  const communityUrls = getCommunityUrlsFromConfig(config);
  return communityUrls[locale];
}
