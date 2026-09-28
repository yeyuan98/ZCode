import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeUpdateFeedBaseUrl,
  resolveAutoUpdaterAllowPrerelease,
  resolveReleaseChannelForVersion,
  resolveUpdateFeedOverrideFromStartupConfig,
  resolveUpdateFeedProviderConfig,
  UPDATE_FEED_URL_ENV,
  UPDATE_FEED_URL_SWITCH,
} from "../src/main/updateFeedRuntime.js";

// P5（specs/distribution-and-updates.md §A / D-P5.1）回归钉：
// 1) allowPrerelease 下限规则；2) 镜像覆盖解析（无 isPackaged 守卫 + URL 校验 + 归一）；
// 3) provider 选择（覆盖 → generic，默认 → github）。

test("resolveAutoUpdaterAllowPrerelease：D-P5.1 下限规则", () => {
  // alpha 当前版本 + 预览关闭 → 必须放行 prerelease（/releases/latest 404 兜底）。
  assert.equal(resolveAutoUpdaterAllowPrerelease(false, "3.14.3-alpha.8"), true);
  assert.equal(resolveAutoUpdaterAllowPrerelease(undefined, "3.14.3-alpha.8"), true);
  // 稳定当前版本 + 预览关闭 → 关闭。
  assert.equal(resolveAutoUpdaterAllowPrerelease(false, "3.14.3"), false);
  assert.equal(resolveAutoUpdaterAllowPrerelease(undefined, "3.14.3"), false);
  // 预览开启 → 恒为 true（即便当前是稳定版）。
  assert.equal(resolveAutoUpdaterAllowPrerelease(true, "3.14.3"), true);
  assert.equal(resolveAutoUpdaterAllowPrerelease(true, "3.14.3-alpha.8"), true);
});

test("resolveAutoUpdaterAllowPrerelease：非法版本号不抬高下限（semver.prerelease 返回 null）", () => {
  assert.equal(resolveAutoUpdaterAllowPrerelease(false, "not-a-version"), false);
});

test("resolveReleaseChannelForVersion：preview/stable 标签由版本号推导", () => {
  assert.equal(resolveReleaseChannelForVersion("3.14.3-alpha.9"), "preview");
  assert.equal(resolveReleaseChannelForVersion("3.14.3-beta.1+meta"), "preview");
  assert.equal(resolveReleaseChannelForVersion("3.14.3"), "stable");
});

test("normalizeUpdateFeedBaseUrl：只接受无 query/hash 的 http(s) BASE URL 并归一尾部斜杠", () => {
  assert.equal(
    normalizeUpdateFeedBaseUrl("https://mirror.example.com/zcode"),
    "https://mirror.example.com/zcode/",
  );
  assert.equal(
    normalizeUpdateFeedBaseUrl("https://mirror.example.com/zcode/"),
    "https://mirror.example.com/zcode/",
  );
  assert.equal(
    normalizeUpdateFeedBaseUrl("  http://127.0.0.1:8081/feed  "),
    "http://127.0.0.1:8081/feed/",
  );
  // 非 http(s)、携带 query/hash、空串、非法 URL 一律拒绝。
  assert.equal(normalizeUpdateFeedBaseUrl("ftp://mirror.example.com/feed"), null);
  assert.equal(normalizeUpdateFeedBaseUrl("https://mirror.example.com/feed?a=1"), null);
  assert.equal(normalizeUpdateFeedBaseUrl("https://mirror.example.com/feed#frag"), null);
  assert.equal(normalizeUpdateFeedBaseUrl("not a url"), null);
  assert.equal(normalizeUpdateFeedBaseUrl("   "), null);
});

test("resolveUpdateFeedOverrideFromStartupConfig：arg 优先于 env，返回归一化 base URL", () => {
  const argv = [
    "zcode",
    `--other=1`,
    UPDATE_FEED_URL_SWITCH,
    "https://mirror.example.com/arg-feed",
  ];
  const env = { [UPDATE_FEED_URL_ENV]: "https://mirror.example.com/env-feed" };
  const resolution = resolveUpdateFeedOverrideFromStartupConfig({ argv, env });
  assert.equal(resolution.kind, "override");
  assert.equal(
    resolution.kind === "override" ? resolution.baseUrl : "",
    "https://mirror.example.com/arg-feed/",
  );

  const envOnly = resolveUpdateFeedOverrideFromStartupConfig({
    argv: ["zcode"],
    env: { [UPDATE_FEED_URL_ENV]: "https://mirror.example.com/env-feed" },
  });
  assert.equal(envOnly.kind, "override");
  assert.equal(
    envOnly.kind === "override" ? envOnly.baseUrl : "",
    "https://mirror.example.com/env-feed/",
  );

  // = 形式同样支持。
  const equalsForm = resolveUpdateFeedOverrideFromStartupConfig({
    argv: [`${UPDATE_FEED_URL_SWITCH}=https://mirror.example.com/equals`],
    env: {},
  });
  assert.equal(equalsForm.kind, "override");
});

test("resolveUpdateFeedOverrideFromStartupConfig：无覆盖 / 非法覆盖", () => {
  assert.equal(
    resolveUpdateFeedOverrideFromStartupConfig({ argv: ["zcode"], env: {} }).kind,
    "none",
  );
  assert.equal(resolveUpdateFeedOverrideFromStartupConfig().kind, "none");
  const invalid = resolveUpdateFeedOverrideFromStartupConfig({
    argv: [],
    env: { [UPDATE_FEED_URL_ENV]: "ftp://mirror.example.com/feed" },
  });
  assert.equal(invalid.kind, "invalid");
});

test("resolveUpdateFeedOverrideFromStartupConfig：纯函数不读取 isPackaged（镜像覆盖对打包构建同样生效）", () => {
  // 该纯函数只接收 (argv, env)；P0 期的 app.isPackaged 忽略守卫已按 P5 硬切删除。
  // 若重新引入 isPackaged 判断，函数签名必然扩张——此测试钉住签名不携带该维度。
  const resolution = resolveUpdateFeedOverrideFromStartupConfig({
    argv: [`${UPDATE_FEED_URL_SWITCH}=https://mirror.example.com/feed`],
    env: {},
  });
  assert.equal(resolution.kind, "override");
});

test("resolveUpdateFeedProviderConfig：覆盖 → generic（关闭多 Range），默认 → 本仓库 github", () => {
  assert.deepEqual(resolveUpdateFeedProviderConfig("https://mirror.example.com/feed/"), {
    provider: "generic",
    url: "https://mirror.example.com/feed/",
    useMultipleRangeRequest: false,
  });
  assert.deepEqual(resolveUpdateFeedProviderConfig(undefined), {
    provider: "github",
    owner: "yeyuan98",
    repo: "zodex",
  });
  assert.deepEqual(resolveUpdateFeedProviderConfig("   "), {
    provider: "github",
    owner: "yeyuan98",
    repo: "zodex",
  });
});
