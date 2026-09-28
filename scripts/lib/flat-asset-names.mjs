// P5 W2（specs/distribution-and-updates.md §B.2）：GitHub Release 远程资产扁平命名。
//
// 命名规约：
//   manifest:  manifest-<platformArch>.json（名称不变，仅随扁平布局直接挂在 tag 目录下）
//   组件包:    zcode-remote-<componentId>-<platformArch>-<version>-<sha12>.tar.gz
//     - version 取 manifest 里的组件版本并把 '+' 替换为 '-'（GitHub 资产名中 '+' 不安全）；
//     - sha12 固定为制品 sha256 的前 12 个十六进制字符，保留内容寻址的重发检测能力；
//     - manifest JSON 内的 version 字段保持 '+' 形态不变，只有文件名扁平化。
//
// 解析歧义说明：componentId 自身可含 '-'（server-bundle / node-runtime），version 也可含 '-'
// （prerelease，如 v3.14.3-alpha.9，以及 '+' 展平后的 sha 后缀）。因此解析不靠“数分隔符”，
// 而是按已知的 componentId 前缀切分，再取末段固定 12 位十六进制的 sha12 作为锚点：
//   zcode-remote-<componentId>-<platformArch>-<versionToken>-<sha12>.tar.gz
// sha12 长度与字符集固定，versionToken 无论含多少 '-' 都不会与 sha12 边界混淆；
// versionToken 是展平后的形态，'+' 的原始位置不可从文件名还原（内容寻址以 sha12 为准）。

const FLAT_REMOTE_ASSET_ARTIFACT_PREFIX = "zcode-remote-";
const FLAT_REMOTE_ASSET_ARTIFACT_EXTENSION = ".tar.gz";
const FLAT_REMOTE_ASSET_MANIFEST_FILE_PREFIX = "manifest-";
const FLAT_REMOTE_ASSET_MANIFEST_FILE_EXTENSION = ".json";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SHA12_PATTERN = /^[a-f0-9]{12}$/u;
const COMPONENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const PLATFORM_ARCH_PATTERN = /^[a-z0-9]+-[a-z0-9]+$/u;

function toSha256Hex(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function flattenVersionToken(version) {
  const raw = String(version ?? "").trim();
  if (!raw || raw.includes("/")) {
    throw new Error(`[flat-asset-names] invalid component version: ${String(version)}`);
  }
  const flattened = raw.replaceAll("+", "-");
  if (!flattened || flattened.startsWith("-") || flattened.endsWith("-")) {
    throw new Error(`[flat-asset-names] invalid component version: ${String(version)}`);
  }
  return flattened;
}

export function buildFlatRemoteAssetArtifactName({ componentId, platformArch, version, sha256 }) {
  const id = String(componentId ?? "").trim();
  if (!COMPONENT_ID_PATTERN.test(id)) {
    throw new Error(`[flat-asset-names] invalid componentId: ${String(componentId)}`);
  }
  const arch = String(platformArch ?? "").trim();
  if (!PLATFORM_ARCH_PATTERN.test(arch)) {
    throw new Error(`[flat-asset-names] invalid platformArch: ${String(platformArch)}`);
  }
  const normalizedSha256 = toSha256Hex(sha256);
  if (!SHA256_PATTERN.test(normalizedSha256)) {
    throw new Error(`[flat-asset-names] invalid component sha256: ${String(sha256)}`);
  }
  const versionToken = flattenVersionToken(version);
  return `${FLAT_REMOTE_ASSET_ARTIFACT_PREFIX}${id}-${arch}-${versionToken}-${normalizedSha256.slice(0, 12)}${FLAT_REMOTE_ASSET_ARTIFACT_EXTENSION}`;
}

export function buildFlatRemoteAssetManifestName(platformArch) {
  const arch = String(platformArch ?? "").trim();
  if (!PLATFORM_ARCH_PATTERN.test(arch)) {
    throw new Error(`[flat-asset-names] invalid platformArch: ${String(platformArch)}`);
  }
  return `${FLAT_REMOTE_ASSET_MANIFEST_FILE_PREFIX}${arch}${FLAT_REMOTE_ASSET_MANIFEST_FILE_EXTENSION}`;
}

// 按已知 componentId 列表解析扁平组件文件名，返回 { componentId, platformArch, version, sha12 }。
// version 为展平形态（'+' 已替换为 '-'）；knownComponentIds 需覆盖目标 id（长 id 优先匹配，避免前缀互吞）。
export function parseFlatRemoteAssetArtifactName(name, knownComponentIds) {
  const raw = String(name ?? "").trim();
  const ids = [...knownComponentIds].sort((left, right) => right.length - left.length);
  for (const componentId of ids) {
    if (!COMPONENT_ID_PATTERN.test(componentId)) {
      throw new Error(`[flat-asset-names] invalid known componentId: ${String(componentId)}`);
    }
    const prefix = `${FLAT_REMOTE_ASSET_ARTIFACT_PREFIX}${componentId}-`;
    if (!raw.startsWith(prefix)) {
      continue;
    }
    if (!raw.endsWith(FLAT_REMOTE_ASSET_ARTIFACT_EXTENSION)) {
      continue;
    }
    const body = raw.slice(prefix.length, -FLAT_REMOTE_ASSET_ARTIFACT_EXTENSION.length);
    const bodySegments = body.split("-");
    const sha12 = bodySegments.at(-1);
    if (!SHA12_PATTERN.test(sha12 ?? "")) {
      continue;
    }
    if (bodySegments.length < 4) {
      continue;
    }
    const platformArch = `${bodySegments[0]}-${bodySegments[1]}`;
    if (!PLATFORM_ARCH_PATTERN.test(platformArch)) {
      continue;
    }
    const version = bodySegments.slice(2, -1).join("-");
    if (!version || version.startsWith("-") || version.endsWith("-")) {
      continue;
    }
    return { componentId, platformArch, version, sha12 };
  }
  throw new Error(`[flat-asset-names] not a flat remote asset name: ${String(name)}`);
}
