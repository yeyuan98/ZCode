import assert from "node:assert/strict";
import test from "node:test";
import {
  applyUpdaterCacheIsolation,
  UPDATER_CACHE_DIR_NAME,
} from "../scripts/updaterCacheIsolation.mjs";

test("applyUpdaterCacheIsolation：缺失时追加 updaterCacheDirName", () => {
  assert.equal(
    applyUpdaterCacheIsolation("provider: github\nowner: yeyuan98\nrepo: zodex\n"),
    `provider: github\nowner: yeyuan98\nrepo: zodex\nupdaterCacheDirName: ${UPDATER_CACHE_DIR_NAME}\n`,
  );
});

test("applyUpdaterCacheIsolation：替换已存在的 updaterCacheDirName 值", () => {
  assert.equal(
    applyUpdaterCacheIsolation("updaterCacheDirName: zcode-dev-updater\nowner: yeyuan98\n"),
    `updaterCacheDirName: ${UPDATER_CACHE_DIR_NAME}\nowner: yeyuan98\n`,
  );
});

test("applyUpdaterCacheIsolation：保留其余行且无行尾换行时补齐分隔", () => {
  assert.equal(
    applyUpdaterCacheIsolation("provider: github\nowner: yeyuan98"),
    `provider: github\nowner: yeyuan98\nupdaterCacheDirName: ${UPDATER_CACHE_DIR_NAME}\n`,
  );
});

test("applyUpdaterCacheIsolation：已隔离的 YAML 原样返回（幂等）", () => {
  const isolated = `repo: zodex\nupdaterCacheDirName: ${UPDATER_CACHE_DIR_NAME}\n`;
  assert.equal(applyUpdaterCacheIsolation(isolated), isolated);
});
