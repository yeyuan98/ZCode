import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PLUGIN_MARKETPLACES,
  isAllowedPersistedMarketplaceSource,
  isValidPersistedMarketplaceSource,
} from "../src/plugin-marketplaces.js";

/**
 * P6（specs/distribution-and-updates.md P6 修订）：known_marketplaces 落盘记录的
 * 严格形状校验 + 保留 id 磁盘 source 契约。旧宽松守卫（isRecord(source) 即通过、
 * array/map 双容器）随“遗留结构一律删除”裁决下线：不匹配的旧记录加载即丢弃，
 * 默认市场由 ensure 自动重播种；个人市场（非保留 id）的一切合法源全保留（I8）。
 */

test("source 形状校验：各判别式的合法形态通过", () => {
  const valid: unknown[] = [
    { source: "url", url: "https://example.com/marketplace.json" },
    { source: "url", url: "https://example.com/marketplace.json", headers: { a: "b" } },
    { source: "github", repo: "yeyuan98/zcode-plugins" },
    { source: "git", url: "https://example.com/repo.git" },
    { source: "npm", package: "@scope/pkg" },
    { source: "file", path: "/tmp/marketplace.json" },
    { source: "directory", path: "/tmp/marketplace-dir" },
    { source: "hostPattern", hostPattern: "example.com" },
    { source: "pathPattern", pathPattern: "/marketplace/**" },
    {
      source: "settings",
      marketplace: { name: "custom", plugins: [], raw: {} },
    },
    { source: "bundled" },
  ];
  for (const source of valid) {
    assert.equal(isValidPersistedMarketplaceSource(source), true, JSON.stringify(source));
  }
});

test("source 形状校验：未知判别式/缺必需字段/非对象整份拒绝", () => {
  const invalid: unknown[] = [
    null,
    "url",
    {},
    { source: "cdn" },
    { source: "url" },
    { source: "url", url: "" },
    { source: "github" },
    { source: "git", url: 42 },
    { source: "npm" },
    { source: "file", path: "" },
    { source: "directory", paths: "/x" },
    { source: "hostPattern" },
    { source: "pathPattern" },
    { source: "settings" },
    { source: "settings", marketplace: { name: 1, plugins: [] } },
    { source: "settings", marketplace: { name: "x", plugins: "no" } },
  ];
  for (const source of invalid) {
    assert.equal(isValidPersistedMarketplaceSource(source), false, JSON.stringify(source));
  }
});

test("保留 id 磁盘契约：官方只认 bundled，libre 只认默认 raw url", () => {
  const [official, libre] = DEFAULT_PLUGIN_MARKETPLACES;
  assert.equal(official.source, undefined);
  assert.ok(libre.source);
  assert.equal(isAllowedPersistedMarketplaceSource(official.id, { source: "bundled" }), true);
  assert.equal(
    isAllowedPersistedMarketplaceSource(official.id, {
      source: "url",
      url: "https://example.com/marketplace.json",
    }),
    false,
    "官方 id 携带网络源（含历史供应商 CDN 遗留形状）必须丢弃",
  );
  assert.equal(
    isAllowedPersistedMarketplaceSource(libre.id, { source: "url", url: libre.source }),
    true,
  );
  assert.equal(
    isAllowedPersistedMarketplaceSource(libre.id, {
      source: "url",
      url: "https://example.com/foreign.json",
    }),
    false,
    "libre id 的冒名外部 url 必须丢弃",
  );
  assert.equal(isAllowedPersistedMarketplaceSource(libre.id, { source: "bundled" }), false);
});

test("个人市场（非保留 id）接受一切合法形状；形状非法仍拒绝", () => {
  assert.equal(
    isAllowedPersistedMarketplaceSource("my-market", {
      source: "url",
      url: "https://example.com/marketplace.json",
    }),
    true,
  );
  assert.equal(
    isAllowedPersistedMarketplaceSource("my-market", {
      source: "github",
      repo: "yeyuan98/zcode-plugins",
    }),
    true,
  );
  assert.equal(isAllowedPersistedMarketplaceSource("my-market", { source: "cdn" }), false);
});

test("外部契约钉死：libre 目录指向 yeyuan98/zcode-plugins 仓库 raw catalog", () => {
  const libre = DEFAULT_PLUGIN_MARKETPLACES.find(
    (marketplace) => marketplace.id === "zcode-plugins-libre",
  );
  assert.ok(libre);
  // 外部 repo（github.com/yeyuan98/zcode-plugins）的 catalog-id 契约：id 与 raw url
  // 变更会同时破坏保留 id 守卫与已落盘记录的重播种。
  assert.equal(
    libre.source,
    "https://raw.githubusercontent.com/yeyuan98/zcode-plugins/main/marketplace.json",
  );
});
