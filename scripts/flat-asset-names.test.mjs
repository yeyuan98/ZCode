import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFlatRemoteAssetArtifactName,
  buildFlatRemoteAssetManifestName,
  parseFlatRemoteAssetArtifactName,
} from "./lib/flat-asset-names.mjs";

const knownComponentIds = [
  "server-bundle",
  "node-runtime",
  "node-pty",
  "zcode",
  "bfs",
  "ripgrep",
  "ugrep",
];

test("build/parse round-trip：含 '+' 的内容寻址版本", () => {
  const name = buildFlatRemoteAssetArtifactName({
    componentId: "server-bundle",
    platformArch: "linux-x64",
    version: "v3.14.3-alpha.9+4e5f6a7b8c9d",
    sha256: "4e5f6a7b8c9d0123456789abcdef0123456789abcdef0123456789abcdef0123",
  });
  assert.equal(
    name,
    "zcode-remote-server-bundle-linux-x64-v3.14.3-alpha.9-4e5f6a7b8c9d-4e5f6a7b8c9d.tar.gz",
  );
  assert.deepEqual(parseFlatRemoteAssetArtifactName(name, knownComponentIds), {
    componentId: "server-bundle",
    platformArch: "linux-x64",
    version: "v3.14.3-alpha.9-4e5f6a7b8c9d",
    sha12: "4e5f6a7b8c9d",
  });
});

test("build/parse round-trip：darwin 与纯语义版本（无 build 后缀）", () => {
  for (const [componentId, platformArch, version] of [
    ["ripgrep", "darwin-arm64", "v13.0.0-10"],
    ["node-runtime", "darwin-x64", "v22.16.0"],
    ["node-pty", "linux-arm64", "v1.2.0-beta.10"],
  ]) {
    const sha256 = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const name = buildFlatRemoteAssetArtifactName({ componentId, platformArch, version, sha256 });
    assert.equal(
      name,
      `zcode-remote-${componentId}-${platformArch}-${version}-abcdef012345.tar.gz`,
    );
    assert.deepEqual(parseFlatRemoteAssetArtifactName(name, knownComponentIds), {
      componentId,
      platformArch,
      version,
      sha12: "abcdef012345",
    });
  }
});

test("sha12 固定取制品 sha256 前 12 位小写", () => {
  const name = buildFlatRemoteAssetArtifactName({
    componentId: "zcode",
    platformArch: "linux-x64",
    version: "v1.3.0",
    sha256: "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789",
  });
  assert.match(name, /-abcdef012345\.tar\.gz$/u);
});

test("manifest 名称构造", () => {
  assert.equal(buildFlatRemoteAssetManifestName("linux-x64"), "manifest-linux-x64.json");
  assert.equal(buildFlatRemoteAssetManifestName("darwin-arm64"), "manifest-darwin-arm64.json");
  assert.throws(() => buildFlatRemoteAssetManifestName("linux_x64"));
  assert.throws(() => buildFlatRemoteAssetManifestName(""));
});

test("非法输入被拒绝", () => {
  const valid = {
    componentId: "bfs",
    platformArch: "linux-x64",
    version: "v4.1.1-2",
    sha256: "a".repeat(64),
  };
  assert.throws(() => buildFlatRemoteAssetArtifactName({ ...valid, componentId: "" }));
  assert.throws(() => buildFlatRemoteAssetArtifactName({ ...valid, componentId: "-leading" }));
  assert.throws(() => buildFlatRemoteAssetArtifactName({ ...valid, platformArch: "linux" }));
  assert.throws(() => buildFlatRemoteAssetArtifactName({ ...valid, platformArch: "a/b" }));
  assert.throws(() => buildFlatRemoteAssetArtifactName({ ...valid, version: "" }));
  assert.throws(() => buildFlatRemoteAssetArtifactName({ ...valid, version: "1.0.0/" }));
  assert.throws(() => buildFlatRemoteAssetArtifactName({ ...valid, version: "1.0.0+" }));
  assert.throws(() => buildFlatRemoteAssetArtifactName({ ...valid, sha256: "a".repeat(63) }));
  assert.throws(() => buildFlatRemoteAssetArtifactName({ ...valid, sha256: "g".repeat(64) }));
});

test("parse：未知 id、损坏的 sha 段与错误扩展名均失败", () => {
  assert.throws(() =>
    parseFlatRemoteAssetArtifactName(
      "zcode-remote-unknown-tool-linux-x64-v1.0.0-abcdef012345.tar.gz",
      knownComponentIds,
    ),
  );
  assert.throws(() =>
    parseFlatRemoteAssetArtifactName(
      "zcode-remote-zcode-linux-x64-v1.0.0-abcdef0123456.tar.gz",
      knownComponentIds,
    ),
  );
  assert.throws(() =>
    parseFlatRemoteAssetArtifactName(
      "zcode-remote-zcode-linux-x64-v1.0.0-abcdef012345.zip",
      knownComponentIds,
    ),
  );
  assert.throws(() =>
    parseFlatRemoteAssetArtifactName("manifest-linux-x64.json", knownComponentIds),
  );
});

test("parse：长 componentId 优先匹配，避免前缀互吞", () => {
  const name = buildFlatRemoteAssetArtifactName({
    componentId: "zcode-extra",
    platformArch: "linux-x64",
    version: "v1.0.0",
    sha256: "b".repeat(64),
  });
  assert.deepEqual(parseFlatRemoteAssetArtifactName(name, ["zcode", "zcode-extra"]), {
    componentId: "zcode-extra",
    platformArch: "linux-x64",
    version: "v1.0.0",
    sha12: "bbbbbbbbbbbb",
  });
});
