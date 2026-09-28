import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRemoteCdnBaseVersionMatches,
  buildArtifactUrlCandidates,
  buildComponentArtifactUrlCandidates,
  buildComponentReleaseBaseCandidates,
  buildFlatArtifactUrlCandidates,
  buildReleaseAssetUrlCandidates,
  buildReleaseBaseCandidates,
} from "@zcode/server/remote/remoteAssetCdn.js";

// P5 W2 回归钉（specs/distribution-and-updates.md §B）：
// - GitHub Releases tag 目录（…/releases/download/v<version>）= 扁平布局，manifest 与组件
//   都恰好一个 URL，不做版本子目录追加、不做 components 根目录跨版本探测；
// - 镜像覆盖保持嵌套行为：裸 semver 固定 = 单候选 + 版本锁校验；未固定 = [base/<v>, base]；
// - 版本锁校验同时识别裸 semver 与 `v` 前缀 tag 目录。

const APP_VERSION = "3.14.3-alpha.9";
const GITHUB_TAG_BASE = `https://github.com/yeyuan98/ZCode/releases/download/v${APP_VERSION}`;

test("扁平布局：manifest 候选恰好一个（tag 目录直连）", () => {
  const releaseBaseCandidates = buildReleaseBaseCandidates([GITHUB_TAG_BASE], APP_VERSION);
  assert.deepEqual(releaseBaseCandidates, [GITHUB_TAG_BASE]);
  assert.deepEqual(
    buildReleaseAssetUrlCandidates(releaseBaseCandidates, ["manifest-linux-x64.json"]),
    [`${GITHUB_TAG_BASE}/manifest-linux-x64.json`],
  );
});

test("扁平布局：组件候选恰好一个（无 components 根探测、无第二候选）", () => {
  const flatArtifactPath =
    "zcode-remote-server-bundle-linux-x64-v3.14.3-alpha.9-4e5f6a7b8c9d-4e5f6a7b8c9d.tar.gz";
  assert.deepEqual(
    buildComponentArtifactUrlCandidates([GITHUB_TAG_BASE], flatArtifactPath, APP_VERSION),
    [`${GITHUB_TAG_BASE}/${flatArtifactPath}`],
  );
  assert.deepEqual(buildComponentReleaseBaseCandidates([GITHUB_TAG_BASE], APP_VERSION), [
    GITHUB_TAG_BASE,
  ]);
});

test("扁平布局：末段 `v` 与当前版本不完全一致时不按扁平处理（走嵌套候选）", () => {
  const staleTagBase = "https://github.com/yeyuan98/ZCode/releases/download/v3.14.2";
  assert.deepEqual(buildReleaseBaseCandidates([staleTagBase], APP_VERSION), [
    `${staleTagBase}/${APP_VERSION}`,
    staleTagBase,
  ]);
});

test("buildFlatArtifactUrlCandidates：单候选 + 路径段 URL 编码", () => {
  assert.deepEqual(buildFlatArtifactUrlCandidates(GITHUB_TAG_BASE, "manifest-darwin-arm64.json"), [
    `${GITHUB_TAG_BASE}/manifest-darwin-arm64.json`,
  ]);
  // 扁平文件名不含 '+'，但编码路径必须保留（嵌套 artifactPath 仍会带 '+' 版本段）。
  assert.deepEqual(
    buildFlatArtifactUrlCandidates(
      "https://mirror.example.com/base/",
      "v1.3.0+abcd1234ef56.tar.gz",
    ),
    ["https://mirror.example.com/base/v1.3.0%2Babcd1234ef56.tar.gz"],
  );
});

test("嵌套镜像：裸 semver 固定基址 = 单候选，组件先探测父级 release root", () => {
  const pinnedBase = `https://mirror.example.com/cdn/releases/${APP_VERSION}`;
  assert.deepEqual(buildReleaseBaseCandidates([pinnedBase], APP_VERSION), [pinnedBase]);
  assert.deepEqual(buildComponentReleaseBaseCandidates([pinnedBase], APP_VERSION), [
    "https://mirror.example.com/cdn/releases",
    pinnedBase,
  ]);
  assert.deepEqual(
    buildComponentArtifactUrlCandidates(
      [pinnedBase],
      "components/linux-x64/node-runtime/v22.16.0.tar.gz",
      APP_VERSION,
    ),
    [
      "https://mirror.example.com/cdn/releases/components/linux-x64/node-runtime/v22.16.0.tar.gz",
      `${pinnedBase}/components/linux-x64/node-runtime/v22.16.0.tar.gz`,
    ],
  );
});

test("嵌套镜像：未固定基址 = [base/<v>, base] 两候选", () => {
  const rootBase = "https://mirror.example.com/cdn/releases";
  assert.deepEqual(buildReleaseBaseCandidates([rootBase], APP_VERSION), [
    `${rootBase}/${APP_VERSION}`,
    rootBase,
  ]);
});

test("版本锁校验：`v` 前缀与裸 semver 都识别，比较时去掉 `v`", () => {
  assert.doesNotThrow(() => assertRemoteCdnBaseVersionMatches([GITHUB_TAG_BASE], APP_VERSION));
  assert.doesNotThrow(() =>
    assertRemoteCdnBaseVersionMatches(
      [`https://mirror.example.com/cdn/${APP_VERSION}`],
      APP_VERSION,
    ),
  );
  assert.throws(() =>
    assertRemoteCdnBaseVersionMatches(
      ["https://github.com/yeyuan98/ZCode/releases/download/v3.14.2"],
      APP_VERSION,
    ),
  );
  assert.throws(() =>
    assertRemoteCdnBaseVersionMatches(["https://mirror.example.com/cdn/0.2.7"], APP_VERSION),
  );
  // 未固定基址不参与版本锁。
  assert.doesNotThrow(() =>
    assertRemoteCdnBaseVersionMatches(["https://mirror.example.com/cdn"], APP_VERSION),
  );
});

test("buildArtifactUrlCandidates：多基址按序去重", () => {
  assert.deepEqual(
    buildArtifactUrlCandidates(
      ["https://a.example.com", "https://b.example.com/", "https://a.example.com"],
      "components/linux-x64/bfs/v4.1.1-2.tar.gz",
    ),
    [
      "https://a.example.com/components/linux-x64/bfs/v4.1.1-2.tar.gz",
      "https://b.example.com/components/linux-x64/bfs/v4.1.1-2.tar.gz",
    ],
  );
});
