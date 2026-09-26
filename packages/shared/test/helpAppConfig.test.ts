import assert from "node:assert/strict";
import test from "node:test";
import { resolveHelpAppConfig } from "../src/helpAppConfig.ts";

test("resolves feedback and per-locale community entries from local config", () => {
  const config = resolveHelpAppConfig({
    feedback_url: "https://github.com/example/zcode/issues/new",
    community_urls: {
      "zh-CN": "https://github.com/example/zcode/discussions",
      "en-US": "https://discord.gg/example",
    },
  });
  assert.equal(config.feedback_url, "https://github.com/example/zcode/issues/new");
  assert.equal(config.community_urls["zh-CN"], "https://github.com/example/zcode/discussions");
  assert.equal(config.community_urls["en-US"], "https://discord.gg/example");
});

test("missing or invalid config degrades to undefined entries, never throws", () => {
  // P2：帮助配置只读本地文件；解析失败必须安静降级，由调用方走默认 Issues 入口兜底。
  for (const input of [undefined, null, "not-an-object", {}, { feedback_url: 42 }]) {
    const config = resolveHelpAppConfig(input);
    assert.equal(config.feedback_url, undefined);
    assert.equal(config.community_urls["zh-CN"], undefined);
    assert.equal(config.community_urls["en-US"], undefined);
  }
});

test("community entries do not cross-fallback between locales", () => {
  const config = resolveHelpAppConfig({
    community_urls: { "zh-CN": "https://example.com/zh" },
  });
  assert.equal(config.community_urls["zh-CN"], "https://example.com/zh");
  assert.equal(config.community_urls["en-US"], undefined);
});
