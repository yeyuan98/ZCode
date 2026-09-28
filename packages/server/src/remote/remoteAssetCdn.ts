import { posix } from "node:path";

export interface RemoteCdnBaseOptions {
  remoteCdnBaseUrl?: string;
  remoteCdnBaseUrls?: string[];
}

export function resolveRemoteCdnBaseUrls(options: RemoteCdnBaseOptions): string[] {
  const candidates = [...(options.remoteCdnBaseUrls ?? []), options.remoteCdnBaseUrl ?? ""]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(candidates));
}

export function buildReleaseBaseCandidates(remoteCdnBaseUrls: string[], version: string): string[] {
  const candidates = remoteCdnBaseUrls.flatMap((remoteCdnBaseUrl) => {
    const normalizedBase = remoteCdnBaseUrl.replace(/\/+$/, "");
    // P5 W2（specs/distribution-and-updates.md §B）：默认源是 GitHub Releases tag 目录
    // （…/releases/download/v<version>，扁平布局）。基址末段恰好是 `v<当前版本>` 时按 tag 目录
    // 识别：manifest 与组件都直接位于该目录下，不追加版本子目录，也不产生跨版本探测候选。
    if (isFlatGithubTagReleaseBase(normalizedBase, version)) {
      return [normalizedBase];
    }
    // 当调用方已经传入带版本的 CDN 基址时，继续盲目拼 `${base}/${version}`
    // 会先走一次必然失败的双版本路径（例如 .../0.2.10/0.2.10），产生无意义 404 噪音。
    // 这里识别“已固定到当前版本”的场景，直接使用原基址即可。
    if (normalizedBase.endsWith(`/${version}`)) {
      return [normalizedBase];
    }
    return [`${normalizedBase}/${version}`, normalizedBase];
  });
  return Array.from(new Set(candidates));
}

export function buildReleaseAssetUrlCandidates(
  releaseBaseCandidates: string[],
  fileCandidates: string[],
): string[] {
  const urls: string[] = [];
  for (const fileCandidate of fileCandidates) {
    const normalizedFileCandidate = normalizeRemoteAssetRelativePath(
      fileCandidate,
      "release asset path",
    );
    for (const releaseBaseCandidate of releaseBaseCandidates) {
      urls.push(joinCdnUrl(releaseBaseCandidate, normalizedFileCandidate));
    }
  }
  return Array.from(new Set(urls));
}

export function buildArtifactUrlCandidates(
  remoteCdnBaseUrls: string[],
  artifactPath: string,
): string[] {
  const normalizedArtifactPath = normalizeRemoteAssetRelativePath(artifactPath, "artifactPath");
  const urls = remoteCdnBaseUrls.map((remoteCdnBaseUrl) =>
    joinCdnUrl(remoteCdnBaseUrl, normalizedArtifactPath),
  );
  return Array.from(new Set(urls));
}

export function buildComponentArtifactUrlCandidates(
  releaseBaseCandidates: string[],
  artifactPath: string,
  version: string,
): string[] {
  const normalizedArtifactPath = normalizeRemoteAssetRelativePath(artifactPath, "artifactPath");
  // P5 W2：扁平布局（GitHub Releases tag 目录）下组件 artifactPath 本身就是扁平文件名，
  // 恰好一个 URL —— 不做 components 根目录跨版本探测，也不产生第二个候选。
  const urls = releaseBaseCandidates.flatMap((releaseBaseCandidate) =>
    isFlatGithubTagReleaseBase(releaseBaseCandidate, version)
      ? buildFlatArtifactUrlCandidates(releaseBaseCandidate, normalizedArtifactPath)
      : buildArtifactUrlCandidates(
          buildComponentReleaseBaseCandidates([releaseBaseCandidate], version),
          normalizedArtifactPath,
        ),
  );
  return Array.from(new Set(urls));
}

// P5 W2 新增：扁平布局的单候选构造器。基址必须是 GitHub Releases tag 目录（v<当前版本> 末段），
// artifactPath 为 manifest 里的扁平文件名（manifest-<platformArch>.json 同样适用）。
export function buildFlatArtifactUrlCandidates(baseUrl: string, artifactPath: string): string[] {
  return [joinCdnUrl(baseUrl, normalizeRemoteAssetRelativePath(artifactPath, "artifactPath"))];
}

export function buildComponentReleaseBaseCandidates(
  releaseBaseCandidates: string[],
  version: string,
): string[] {
  const candidates = releaseBaseCandidates.flatMap((releaseBaseCandidate) => {
    const normalizedBase = releaseBaseCandidate.replace(/\/+$/, "");
    // P5 W2：GitHub Releases tag 目录（扁平布局）没有跨版本 components 根目录，
    // 组件只从 tag 目录本身取 —— 不探测父级 release root。
    if (isFlatGithubTagReleaseBase(normalizedBase, version)) {
      return [normalizedBase];
    }
    if (normalizedBase.endsWith(`/${version}`)) {
      // 当前 CI 只把 component artifact 上传到跨版本 components 根目录。
      // 因此运行时应先探测父级 release root，避免每个组件都先命中一次已停止发布的版本化路径。
      return [normalizedBase.slice(0, -version.length - 1), normalizedBase];
    }
    return [normalizedBase];
  });
  return Array.from(new Set(candidates.filter((candidate) => candidate.length > 0)));
}

export function normalizeRemoteAssetRelativePath(rawPath: string, label: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error(`[remote-assets] ${label} is empty`);
  }
  if (trimmed.includes("\\")) {
    throw new Error(`[remote-assets] ${label} must not contain backslash: ${rawPath}`);
  }
  if (trimmed.startsWith("/") || /^[A-Za-z]:/u.test(trimmed)) {
    throw new Error(`[remote-assets] ${label} must be relative path: ${rawPath}`);
  }

  const rawSegments = trimmed.split("/");
  if (rawSegments.some((segment) => segment.length === 0)) {
    throw new Error(`[remote-assets] ${label} contains empty path segment: ${rawPath}`);
  }
  if (rawSegments.includes("..")) {
    throw new Error(`[remote-assets] ${label} must not contain '..': ${rawPath}`);
  }
  if (rawSegments.includes(".")) {
    throw new Error(`[remote-assets] ${label} must not contain '.': ${rawPath}`);
  }

  const normalized = posix.normalize(trimmed);
  const normalizedSegments = normalized.split("/");
  if (
    normalizedSegments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new Error(`[remote-assets] ${label} is invalid after normalize: ${rawPath}`);
  }

  return normalizedSegments.join("/");
}

export function assertRemoteCdnBaseVersionMatches(
  remoteCdnBaseUrls: string[],
  expectedVersion: string,
): void {
  const mismatchedBases = remoteCdnBaseUrls.flatMap((remoteCdnBaseUrl) => {
    const pinnedVersion = extractPinnedReleaseVersionFromCdnBaseUrl(remoteCdnBaseUrl);
    if (!pinnedVersion || pinnedVersion === expectedVersion) {
      return [];
    }

    return [{ remoteCdnBaseUrl, pinnedVersion }];
  });
  if (mismatchedBases.length === 0) {
    return;
  }

  // 开发态常会临时覆盖 ZCODE_REMOTE_ASSET_CDN_BASE_URL 做分支联调。
  // 如果把基址固定到旧版本（如 .../0.2.7）但客户端已经是 0.2.10，
  // 之前会把旧 remote-assets 落到新版本缓存目录，最终在 deploy 阶段才报 bundle 版本不匹配。
  // 这里前置做版本锁校验，避免“下载成功但后续部署失败”的误导性体验。
  throw new Error(
    `[remote-assets] remoteCdnBaseUrl 版本不匹配：当前应用版本是 ${expectedVersion}，但以下基址固定在其他版本：` +
      `${mismatchedBases.map(({ remoteCdnBaseUrl, pinnedVersion }) => `${pinnedVersion} (${remoteCdnBaseUrl})`).join(", ")}。` +
      `请将 ZCODE_REMOTE_ASSET_CDN_BASE_URL 改为不带版本的发布根目录，或改为 ${expectedVersion}（或 v${expectedVersion}）对应目录。`,
  );
}

function joinCdnUrl(baseUrl: string, relativePath: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  // 组件版本里会带 '+'（如 v1.3.0+abcd），直接拼 URL 会在部分 CDN 侧命中失败（404）。
  // 这里按路径段做 URL 编码，保证对象 key 与下载 URL 一致（+ -> %2B）。
  const encodedRelativePath = encodeRelativePathForUrl(relativePath);
  return `${normalizedBase}/${encodedRelativePath}`;
}

function encodeRelativePathForUrl(relativePath: string): string {
  return relativePath
    .split("/")
    .map((segment) => encodePathSegment(segment))
    .join("/");
}

function encodePathSegment(segment: string): string {
  // 兼容已编码输入：先尝试解码再编码，避免把 %2B 再编码成 %252B。
  // 若输入包含非法 '%' 序列则回退到直接编码，确保不会抛异常。
  try {
    return encodeURIComponent(decodeURIComponent(segment));
  } catch {
    return encodeURIComponent(segment);
  }
}

function extractPinnedReleaseVersionFromCdnBaseUrl(remoteCdnBaseUrl: string): string | null {
  const normalizedBase = remoteCdnBaseUrl.replace(/\/+$/, "");
  const parsedPathname = tryParseUrlPathname(normalizedBase);
  const pathname = parsedPathname ?? normalizedBase;
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const lastSegment = segments.at(-1);
  if (!lastSegment) {
    return null;
  }

  // P5 W2：GitHub tag 目录以 `v` 前缀固定版本（…/releases/download/v3.14.3-alpha.9）。
  // 版本锁校验必须同时识别裸 semver 与 `v` 前缀两种末段，比较时统一去掉 `v`。
  const versionCandidate = lastSegment.startsWith("v") ? lastSegment.slice(1) : lastSegment;
  return isSemverLike(versionCandidate) ? versionCandidate : null;
}

// P5 W2：识别 GitHub Releases tag 目录（…/releases/download/v<version>）。
// 判定规则保持确定性：基址（URL pathname）末段恰好等于 `v<当前版本>` 才视为扁平布局；
// 裸 semver 末段仍是旧式 CDN 版本目录（嵌套布局），未固定末段保持嵌套多候选探测。
function isFlatGithubTagReleaseBase(baseUrl: string, version: string): boolean {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const parsedPathname = tryParseUrlPathname(normalizedBase);
  const pathname = parsedPathname ?? normalizedBase;
  const lastSegment = pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .at(-1);
  return lastSegment === `v${version}`;
}

function tryParseUrlPathname(urlOrPath: string): string | null {
  try {
    return new URL(urlOrPath).pathname;
  } catch {
    return null;
  }
}

function isSemverLike(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(value);
}
