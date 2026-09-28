import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

// P5 源码扫描守卫（接替已删除的 shared/test/updateFeedPolicy.test.ts 的扫描职责）：
// 更新源切到 electron-updater github provider 后，厂商 manifest provider 与强更链路
// 必须整体退场，且 autoUpdater.channel 永远不允许被赋值（残留 channel 值会改变
// channel 文件名并卡死 GitHubProvider 的 atom 遍历 → ERR_UPDATER_NO_PUBLISHED_VERSIONS）。

const AUTO_UPDATER_PATH = fileURLToPath(new URL("../src/main/autoUpdater.ts", import.meta.url));
const INDEX_PATH = fileURLToPath(new URL("../src/main/index.ts", import.meta.url));
const UPDATE_FEED_RUNTIME_PATH = fileURLToPath(
  new URL("../src/main/updateFeedRuntime.ts", import.meta.url),
);

test("autoUpdater.ts 源码契约：不写 autoUpdater.channel、不引用厂商 manifest provider 与强更链路", async () => {
  const source = await readFile(AUTO_UPDATER_PATH, "utf8");

  assert.ok(
    !/autoUpdater\s*\.\s*channel\s*=/.test(source),
    "禁止给 autoUpdater.channel 赋值（单 channel 文件 D-P5.1）",
  );
  assert.ok(
    !source.includes("manifestUpdateProvider"),
    "厂商 manifest provider 已在 P5 删除，不得重新引入",
  );
  for (const banned of [
    "requestForceAutoUpdate",
    "ForceAutoUpdateState",
    "activeForceAutoUpdateListener",
  ]) {
    assert.ok(!source.includes(banned), `强更机制 ${banned} 已在 P5 删除，不得重新引入`);
  }
});

test("index.ts 源码契约：不再引用 updateFeedPolicy / 强更 gate 与窗口拦截", async () => {
  const source = await readFile(INDEX_PATH, "utf8");

  for (const banned of [
    "isVendorManifestUpdateFeedWired",
    "updateFeedPolicy",
    "maybeBlockStartupForForceUpdate",
    "forceUpdateMainWindowCreationBlocked",
    "focusForceUpdateGateWindow",
  ]) {
    assert.ok(!source.includes(banned), `index.ts 不得再引用已删除的 ${banned}`);
  }

  // 生产 flavor 闸门必须保留（不得借删除厂商策略之机放松产品身份 gating）。
  assert.ok(
    source.includes('enabled: ZCODE_PRODUCT_FLAVOR === "production"'),
    "initAutoUpdater 的 enabled 闸门必须保持 production flavor 判定",
  );
});

test("updateFeedRuntime.ts 源码契约：纯模块不触碰 electron / app.isPackaged", async () => {
  const source = await readFile(UPDATE_FEED_RUNTIME_PATH, "utf8");

  assert.ok(
    !/from\s+"electron"/.test(source),
    "updateFeedRuntime.ts 必须保持无 electron 依赖（可独立单测）",
  );
  assert.ok(!source.includes("isPackaged"), "镜像覆盖解析不得重新引入 isPackaged 守卫（P5 硬切）");
});

test("autoUpdater.ts 源码契约：Windows 更新不变量保持（autoDownload=false / win32 关闭退出即装）", async () => {
  const source = await readFile(AUTO_UPDATER_PATH, "utf8");

  assert.ok(
    source.includes("autoUpdater.autoDownload = false"),
    "autoDownload=false 不变量必须保留",
  );
  assert.ok(
    source.includes('autoUpdater.autoInstallOnAppQuit = process.platform !== "win32"'),
    "win32 关闭 autoInstallOnAppQuit 不变量必须保留",
  );
  assert.ok(
    source.includes("applyUpdateFeed(options)"),
    "initAutoUpdater 必须在任何检查前完成 feed 接线（I1）",
  );
});
