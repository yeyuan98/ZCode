import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isVendorManifestUpdateFeedWired } from "../src/updateFeedPolicy.ts";

/**
 * 契约（specs/telemetry-and-update-policy.md）：
 *
 * `isVendorManifestUpdateFeedWired()` 是三条更新路径共用的唯一策略开关，
 * 纯函数、无 IO。返回 `true` 表示更新源仍接线到厂商 manifest provider
 * （zcode.z.ai），此时桌面 main 必须禁用：
 *   1. 启动检查 + 60 分钟轮询（`initAutoUpdater({ enabled })` 走 enabled:false 早退）；
 *   2. 手动"检查更新"（复用 `autoUpdaterDisabledForProductFlavor` 的 dev-skipped 结果）；
 *   3. 启动强更 gate（跳过 `maybeBlockStartupForForceUpdate`，不请求 /api/v1/client/configs）。
 * P5 换 GitHub provider 后该 flag 删除，三条路径随之恢复。
 */
test("isVendorManifestUpdateFeedWired: 厂商 manifest 源仍接线，flag 必须为 true（守卫应禁用更新）", () => {
  const wired = isVendorManifestUpdateFeedWired();
  assert.equal(typeof wired, "boolean", "flag 必须返回 boolean");
  assert.equal(
    wired,
    true,
    "当前仍接线厂商 manifest provider，改回 false 前必须先落地 GitHub provider（P5）",
  );
});

/** 源码扫描：桌面 main 守卫必须引用该 flag（防止接线被误删而 flag 仍为 true）。 */
test("桌面 main 更新路径守卫引用 isVendorManifestUpdateFeedWired（源码扫描）", async () => {
  const indexSource = await readFile(
    new URL("../../desktop/src/main/index.ts", import.meta.url),
    "utf-8",
  );
  const autoUpdaterSource = await readFile(
    new URL("../../desktop/src/main/autoUpdater.ts", import.meta.url),
    "utf-8",
  );

  // index.ts：启动轮询（initAutoUpdater enabled）+ 强更 gate（maybeBlockStartupForForceUpdate 跳过）。
  assert.ok(
    countOccurrences(indexSource, "isVendorManifestUpdateFeedWired") >= 2,
    "index.ts 应在 initAutoUpdater 与 force-update gate 两处引用策略 flag",
  );
  // autoUpdater.ts：手动"检查更新"的 fail-closed 分支。
  assert.ok(
    countOccurrences(autoUpdaterSource, "isVendorManifestUpdateFeedWired") >= 1,
    "autoUpdater.ts 手动检查应复用策略 flag 走禁用路径",
  );
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
