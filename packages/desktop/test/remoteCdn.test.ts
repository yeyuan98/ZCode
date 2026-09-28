import assert from "node:assert/strict";
import test from "node:test";
import { ZCODE_VERSION } from "@zcode/shared";
import { resolveRemoteCdnBaseUrls } from "../src/main/remoteCdn.js";

// P5 W2 回归钉（specs/distribution-and-updates.md §B.1，D-P5.5）：
// 默认基址 = GitHub Releases tag 目录（v 前缀版本段、扁平布局），
// __ZCODE_CDN_BASE_URL__ 构建期 define 已删除，运行时按
// overrideBaseUrl > env ZCODE_CDN_BASE_URL > GitHub 默认 的优先级解析。

const GITHUB_RELEASES_DOWNLOAD_BASE = "https://github.com/yeyuan98/zodex/releases/download";

test("默认基址：GitHub Releases download + `v` 前缀版本段", () => {
  assert.deepEqual(resolveRemoteCdnBaseUrls(), [
    `${GITHUB_RELEASES_DOWNLOAD_BASE}/v${ZCODE_VERSION}`,
  ]);
  assert.deepEqual(resolveRemoteCdnBaseUrls({ version: "3.14.3-alpha.9" }), [
    `${GITHUB_RELEASES_DOWNLOAD_BASE}/v3.14.3-alpha.9`,
  ]);
});

test("覆盖优先级：overrideBaseUrl > env ZCODE_CDN_BASE_URL > GitHub 默认", () => {
  const previousEnv = process.env.ZCODE_CDN_BASE_URL;
  try {
    process.env.ZCODE_CDN_BASE_URL = "https://env-cdn.example.com/base";
    assert.deepEqual(resolveRemoteCdnBaseUrls(), [
      "https://env-cdn.example.com/base/v" + ZCODE_VERSION,
    ]);
    assert.deepEqual(
      resolveRemoteCdnBaseUrls({ overrideBaseUrl: "https://mirror.example.com/releases/1.2.3/" }),
      ["https://mirror.example.com/releases/1.2.3"],
    );
    process.env.ZCODE_CDN_BASE_URL = "   ";
    assert.deepEqual(resolveRemoteCdnBaseUrls(), [
      `${GITHUB_RELEASES_DOWNLOAD_BASE}/v${ZCODE_VERSION}`,
    ]);
  } finally {
    if (previousEnv === undefined) {
      delete process.env.ZCODE_CDN_BASE_URL;
    } else {
      process.env.ZCODE_CDN_BASE_URL = previousEnv;
    }
  }
});

test("规范化：非 http(s) 基址被拒绝，末尾斜杠被去除", () => {
  assert.throws(() => resolveRemoteCdnBaseUrls({ overrideBaseUrl: "file:///tmp/cdn" }));
  assert.throws(() => resolveRemoteCdnBaseUrls({ overrideBaseUrl: "ftp://cdn.example.com" }));
  assert.deepEqual(resolveRemoteCdnBaseUrls({ overrideBaseUrl: "https://mirror.example.com///" }), [
    "https://mirror.example.com",
  ]);
});
