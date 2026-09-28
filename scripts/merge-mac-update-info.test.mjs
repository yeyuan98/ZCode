import assert from "node:assert/strict";
import test from "node:test";
import { mergeLatestMac, parseLatestMac } from "./merge-mac-update-info.mjs";

// 顺序契约：files[] 先列第一个输入的全部条目（保持其 zip 在前的原序），再列第二个
// 输入的；release-macos-channel 作业固定先传 arm64 目录，因此 arm64 条目在前。
const arm64Yaml = [
  "version: 3.14.3",
  "files:",
  "  - url: Zodex-3.14.3-mac-arm64.zip",
  "    sha512: AAAAARM64ZIP0000==",
  "    size: 100000",
  "  - url: Zodex-3.14.3-mac-arm64.dmg",
  "    sha512: AAAAARM64DMG0000==",
  "    size: 200000",
  "path: Zodex-3.14.3-mac-arm64.zip",
  "sha512: AAAAARM64ZIP0000==",
  "releaseDate: 'Tue, 29 Sep 2026 00:00:00 GMT'",
].join("\n");

const x64Yaml = [
  "version: 3.14.3",
  "files:",
  "  - url: Zodex-3.14.3-mac-x64.zip",
  "    sha512: AAAAX64ZIP00000==",
  "    size: 110000",
  "  - url: Zodex-3.14.3-mac-x64.dmg",
  "    sha512: AAAAX64DMG00000==",
  "    size: 210000",
  "path: Zodex-3.14.3-mac-x64.zip",
  "sha512: AAAAX64ZIP00000==",
  "releaseDate: 'Tue, 29 Sep 2026 00:00:01 GMT'",
].join("\n");

test("parseLatestMac：剥离引号、size 数字化、保留固定形状字段", () => {
  const doc = parseLatestMac(arm64Yaml);
  assert.equal(doc.version, "3.14.3");
  assert.equal(doc.releaseDate, "Tue, 29 Sep 2026 00:00:00 GMT");
  assert.equal(doc.path, "Zodex-3.14.3-mac-arm64.zip");
  assert.equal(doc.files.length, 2);
  assert.deepEqual(doc.files[0], {
    url: "Zodex-3.14.3-mac-arm64.zip",
    sha512: "AAAAARM64ZIP0000==",
    size: 100000,
  });
  assert.equal(doc.files[1].size, 200000);
});

test("mergeLatestMac：合并 4 个条目，arm64（第一输入）在前且各 arch 内保持 zip 先行", () => {
  const merged = parseLatestMac(mergeLatestMac(arm64Yaml, x64Yaml));
  assert.equal(merged.version, "3.14.3");
  assert.deepEqual(
    merged.files.map((entry) => entry.url),
    [
      "Zodex-3.14.3-mac-arm64.zip",
      "Zodex-3.14.3-mac-arm64.dmg",
      "Zodex-3.14.3-mac-x64.zip",
      "Zodex-3.14.3-mac-x64.dmg",
    ],
  );
  // 顶层元数据取第一个输入（arm64），第二个输入的 releaseDate 被丢弃。
  assert.equal(merged.path, "Zodex-3.14.3-mac-arm64.zip");
  assert.equal(merged.sha512, "AAAAARM64ZIP0000==");
  assert.equal(merged.releaseDate, "Tue, 29 Sep 2026 00:00:00 GMT");
  // 输出可被自身解析器往返（字段顺序 version/files/path/sha512/releaseDate）。
  const text = mergeLatestMac(arm64Yaml, x64Yaml);
  assert.match(text, /^version: 3\.14\.3\nfiles:\n/);
  assert.match(text, /releaseDate: 'Tue, 29 Sep 2026 00:00:00 GMT'\n$/);
});

test("mergeLatestMac：version 不一致直接报错", () => {
  const drifted = x64Yaml.replace("version: 3.14.3", "version: 3.14.4");
  assert.throws(() => mergeLatestMac(arm64Yaml, drifted), /version 不一致/);
});

test("mergeLatestMac：条目缺 sha512 直接报错", () => {
  const broken = arm64Yaml.replace("    sha512: AAAAARM64ZIP0000==\n", "");
  assert.throws(() => mergeLatestMac(broken, x64Yaml), /缺少 sha512/);
});

test("mergeLatestMac：条目缺 size 直接报错", () => {
  const broken = arm64Yaml.replace("    size: 100000\n", "");
  assert.throws(() => mergeLatestMac(broken, x64Yaml), /size 缺失或非正整数/);
});

test("mergeLatestMac：两个输入架构重复（均为 arm64）直接报错", () => {
  assert.throws(() => mergeLatestMac(arm64Yaml, arm64Yaml), /架构重复/);
});

test("mergeLatestMac：URL 缺少架构标记直接报错", () => {
  const unmarked = arm64Yaml.replaceAll("-mac-arm64", "-mac");
  assert.throws(() => mergeLatestMac(unmarked, x64Yaml), /-arm64\/-x64 架构标记/);
});

test("mergeLatestMac：zip 条目不足 2 条直接报错", () => {
  const dmgOnly = [
    "version: 3.14.3",
    "files:",
    "  - url: Zodex-3.14.3-mac-arm64.dmg",
    "    sha512: AAAAARM64DMG0000==",
    "    size: 200000",
    "path: Zodex-3.14.3-mac-arm64.dmg",
    "sha512: AAAAARM64DMG0000==",
  ].join("\n");
  assert.throws(() => mergeLatestMac(dmgOnly, x64Yaml), /zip 条目/);
});

test("parseLatestMac：未知顶层字段直接报错（feed 结构漂移需人工确认）", () => {
  const drifted = `${arm64Yaml}\nminimumSystemVersion: 10.15\n`;
  assert.throws(() => mergeLatestMac(drifted, x64Yaml), /未知顶层字段 minimumSystemVersion/);
});
