import semver from "semver";
import type { ElectronReleaseChannel } from "@zcode/shared";

// P5（specs/distribution-and-updates.md §A）：更新源从厂商 manifest provider 切换为
// electron-updater github provider + 可选 generic 镜像覆盖。本模块只承载可在无 electron
// 运行时下单测的纯逻辑（allowPrerelease 解析、镜像覆盖解析、provider 选择），
// autoUpdater.ts 负责接线与副作用。

export const UPDATE_FEED_URL_ENV = "ZCODE_UPDATE_FEED_URL";
export const UPDATE_FEED_URL_SWITCH = "--zcode-update-feed-url";

export const GITHUB_UPDATE_FEED_OWNER = "yeyuan98";
export const GITHUB_UPDATE_FEED_REPO = "zodex";

export type UpdateFeedProviderConfig =
  | { provider: "generic"; url: string; useMultipleRangeRequest: false }
  | { provider: "github"; owner: string; repo: string };

export type UpdateFeedOverrideResolution =
  | { kind: "none" }
  | { kind: "override"; baseUrl: string }
  | { kind: "invalid"; raw: string };

function readSwitchValue(argv: readonly string[], switchName: string): string | undefined {
  const equalsPrefix = `${switchName}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }
    if (arg.startsWith(equalsPrefix)) {
      return arg.slice(equalsPrefix.length).trim() || undefined;
    }
    if (arg === switchName) {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        return next.trim() || undefined;
      }
      return undefined;
    }
  }
  return undefined;
}

/**
 * P5：镜像覆盖不再受打包态守卫限制（原 P0 的忽略逻辑删除，硬切）。
 * 语义 = generic feed 的 BASE URL（latest.yml + 安装包 + .blockmap 平铺在同一前缀下）。
 */
export function normalizeUpdateFeedBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  // electron-updater GenericProvider 会把 baseUrl 的 search 透传给所有请求；
  // 镜像地址不允许携带 query/hash（P5：不在任何更新 URL 上追加查询参数）。
  if (url.search || url.hash) {
    return null;
  }

  // GenericProvider 的 newBaseUrl 自行补尾部斜杠；这里先归一，保证日志与请求 URL 稳定。
  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url.toString();
}

export function resolveUpdateFeedOverrideFromStartupConfig({
  argv = [],
  env = {},
}: {
  argv?: readonly string[];
  env?: Record<string, string | undefined>;
} = {}): UpdateFeedOverrideResolution {
  const raw = readSwitchValue(argv, UPDATE_FEED_URL_SWITCH) ?? env[UPDATE_FEED_URL_ENV]?.trim();
  if (!raw) {
    return { kind: "none" };
  }

  const baseUrl = normalizeUpdateFeedBaseUrl(raw);
  return baseUrl ? { kind: "override", baseUrl } : { kind: "invalid", raw };
}

export function resolveUpdateFeedProviderConfig(
  overrideBaseUrl: string | undefined,
): UpdateFeedProviderConfig {
  const baseUrl = overrideBaseUrl?.trim();
  if (baseUrl) {
    return { provider: "generic", url: baseUrl, useMultipleRangeRequest: false };
  }
  return {
    provider: "github",
    owner: GITHUB_UPDATE_FEED_OWNER,
    repo: GITHUB_UPDATE_FEED_REPO,
  };
}

/**
 * P8（specs/distribution-and-updates.md P8 修订）：allowPrerelease 严格跟随 preview 偏好。
 * 原 D-P5.1 的“当前版本带 prerelease 组件即放行”下限随首个正式版 v3.14.3 发布作废——
 * 它使 alpha 客户端关闭预览后仍被强制检查预发布 feed，“退出 alpha”无法生效。退出语义 =
 * 不降级：客户端保持当前版本，直到下一个正式版版本号超过它。dev 更新流程的下限由
 * autoUpdater.ts 在接线上叠加（本纯模块不知晓 dev override）。
 */
export function resolveAutoUpdaterAllowPrerelease(
  receivePreviewUpdates: boolean | undefined,
): boolean {
  return receivePreviewUpdates === true;
}

/** 单 channel 文件（latest.yml）下，更新条目的 preview/stable 标签直接由版本号推导。 */
export function resolveReleaseChannelForVersion(version: string): ElectronReleaseChannel {
  return (semver.prerelease(version)?.length ?? 0) > 0 ? "preview" : "stable";
}
