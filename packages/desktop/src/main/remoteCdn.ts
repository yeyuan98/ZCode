import { ZCODE_VERSION } from "@zcode/shared";

// P5 W2（specs/distribution-and-updates.md §B.1，D-P5.5）：remote 资产默认源由历史
// 供应商 CDN（嵌套布局）切换为本仓库 GitHub Releases 的扁平布局；
// __ZCODE_CDN_BASE_URL__ 构建期 define 已删除，仅保留运行时 ZCODE_CDN_BASE_URL 覆盖。
const GITHUB_RELEASES_DOWNLOAD_BASE = "https://github.com/yeyuan98/ZCode/releases/download";

export interface ResolveRemoteCdnOptions {
  locale?: string;
  timeZone?: string;
  overrideBaseUrl?: string;
  version?: string;
  now?: Date;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("CDN URL must use http or https");
  return value.replace(/\/+$/, "");
}

export function resolveRemoteCdnBaseUrls(options: ResolveRemoteCdnOptions = {}): string[] {
  const override = options.overrideBaseUrl?.trim();
  if (override) return [normalizeBaseUrl(override)];
  const baseUrl = process.env.ZCODE_CDN_BASE_URL?.trim() || GITHUB_RELEASES_DOWNLOAD_BASE;
  // 默认源是 GitHub Releases tag 目录（…/releases/download/v<version>）：manifest 与组件 tarball
  // 都直接位于 tag 目录下（扁平布局），基址本身就固定了版本，不再追加任何版本子目录。
  return [`${normalizeBaseUrl(baseUrl)}/v${options.version ?? ZCODE_VERSION}`];
}
