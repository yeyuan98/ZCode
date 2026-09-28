import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";
import {
  DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS,
  DEFAULT_PLUGIN_MARKETPLACES,
  PUBLIC_STORE_MARKETPLACE_IDS,
  ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
  isPublicStoreMarketplaceId,
} from "../src/plugin-marketplaces.ts";

/**
 * 契约（specs/distribution-and-updates.md §C，P5 / D-P5.3）：
 *
 * 1. parity：shared 固定的默认启用官方插件集合 ≡ bootstrap 侧
 *    OFFICIAL_PLUGIN_DEFINITIONS 按 defaultEnabled 派生的集合。三处注释曾引用的
 *    「机械对照单测」此前并不存在，本文件补上真实实现。
 * 2. 默认市场形态：官方（zcode-plugins-official）bundled-only 无 source；libre
 *    （zcode-plugins-libre）预注册且指向 raw.githubusercontent 的 marketplace.json；
 *    商店「公开」分段 = 两个市场。
 * 3. 目录守卫：官方插件定义源码不得再出现 vendor CDN 域名 / ZAI_AUTHOR /
 *    OFFICIAL_PLUGIN_ASSETS_BASE_URL。
 * 4. requiresPaidPlan 已从协议 Store Listing schema 端到端删除（源码扫描）。
 */

// parity 用例需先注册 contracts 桩解析钩子（见 pluginMarketplacesP5ParityLoader.mjs
// 头注释），再动态加载 bootstrap 侧定义文件。
register(new URL("./pluginMarketplacesP5ParityLoader.mjs", import.meta.url));

test("默认启用官方插件集合与 bootstrap definition 派生集合一致（parity）", async () => {
  const bootstrap =
    await import("../../../apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts");
  const derived = new Set(
    bootstrap.OFFICIAL_PLUGIN_DEFINITIONS.filter(
      (definition: { defaultEnabled?: boolean }) => definition.defaultEnabled,
    ).map(
      (definition: { name: string }) =>
        `${definition.name}@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID}`,
    ),
  );
  assert.deepEqual(
    [...DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS].sort(),
    [...derived].sort(),
    "shared 固定名单与 official-plugin-definitions.ts 的 defaultEnabled 派生集合必须逐一对应",
  );
  // P5 收敛后的固定形态：仅 in-tree 的 browser-use 与 node-repl-host 默认启用。
  assert.deepEqual([...DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS].sort(), [
    "browser-use@zcode-plugins-official",
    "node-repl-host@zcode-plugins-official",
  ]);
});

test("默认市场形态：官方 bundled-only + libre raw.githubusercontent，公开分段含两者", () => {
  assert.equal(DEFAULT_PLUGIN_MARKETPLACES.length, 2);
  const official = DEFAULT_PLUGIN_MARKETPLACES.find(
    (marketplace) => marketplace.id === "zcode-plugins-official",
  );
  const libre = DEFAULT_PLUGIN_MARKETPLACES.find(
    (marketplace) => marketplace.id === "zcode-plugins-libre",
  );
  assert.ok(official, "官方市场必须预注册");
  assert.ok(libre, "libre 市场必须预注册");
  assert.equal(official.source, undefined, "官方市场 bundled-only：默认条目不得携带网络 source");
  assert.equal(
    libre.source,
    "https://raw.githubusercontent.com/yeyuan98/zodex-plugins/main/marketplace.json",
  );
  assert.deepEqual(
    [...PUBLIC_STORE_MARKETPLACE_IDS],
    ["zcode-plugins-official", "zcode-plugins-libre"],
  );
  assert.equal(isPublicStoreMarketplaceId("zcode-plugins-official"), true);
  assert.equal(isPublicStoreMarketplaceId("zcode-plugins-libre"), true);
  assert.equal(isPublicStoreMarketplaceId("example-marketplace"), false);
});

test("官方插件定义目录无 vendor 残留（cdn-zcode.z.ai / ZAI_AUTHOR / assets 基址）", async () => {
  const definitionsSource = await readFile(
    new URL(
      "../../../apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts",
      import.meta.url,
    ),
    "utf8",
  );
  for (const forbidden of ["cdn-zcode.z.ai", "ZAI_AUTHOR", "OFFICIAL_PLUGIN_ASSETS_BASE_URL"]) {
    assert.equal(
      definitionsSource.includes(forbidden),
      false,
      `${forbidden} 已随 P5 市场去供应商化删除，不应再出现在官方插件定义源码`,
    );
  }
});

test("协议 Store Listing schema 不再包含 requiresPaidPlan（P5 删除，源码扫描）", async () => {
  const protocolSource = await readFile(
    new URL("../src/zcode-protocol/index.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    protocolSource.includes("requiresPaidPlan"),
    false,
    "requiresPaidPlan（vendor Coding-Plan 上销残留）应已从协议 plugins schema 端到端删除",
  );
});
