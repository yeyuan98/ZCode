import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";
import { appSettingsSchema, appSettingsPatchSchema } from "../src/validationAppSettings.ts";

/**
 * 契约（specs/distribution-and-updates.md §Endpoint-origin web + §Migration boundary，P5 / D-P5.4）：
 *
 * 1. `zcodeEndpointOrigin` 已从 AppSettings / patch schema 端到端删除；
    携带该字段的旧 setting.json 仍可解析（zod object 默认 strip 未知键，静默丢弃）。
 * 2. 服务名去厂商化（D7）：zcode-server-cli 的 ServiceDescriptor 默认名与 daemon 名
    前缀为 `app.zcode.server`（无迁移——unregisterService 对“服务不存在”已有容忍）。
 * 3. 源码扫描守卫：仓库源码不再出现 `com.zhipu`（厂商服务命名）；`zcodeEndpointOrigin`
    除本测试外无任何出现。
 */

test("AppSettings schema 不再包含 zcodeEndpointOrigin，旧字段被静默丢弃", () => {
  for (const schema of [appSettingsSchema, appSettingsPatchSchema]) {
    const parsed = schema.parse({
      localePreference: "en-US",
      zcodeEndpointOrigin: "https://endpoint.example.com",
    });
    assert.equal(parsed.localePreference, "en-US");
    assert.equal("zcodeEndpointOrigin" in parsed, false, "endpoint override 字段应被 strip");
  }
});

test("ServiceDescriptor 默认服务名已切换为 app.zcode.server（D7 源码扫描）", async () => {
  const serviceManagerSource = await readFile(
    new URL("../../../packages/zcode-server-cli/src/platform/serviceManager.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    serviceManagerSource.includes('options.name ?? "app.zcode.server"'),
    true,
    "createServiceDescriptor 默认名应为 app.zcode.server",
  );
  assert.equal(
    serviceManagerSource.includes("app.zcode.server.${stablePathId("),
    true,
    "daemon 服务名应保留 per-server-root 后缀模式且前缀为 app.zcode.server",
  );
  assert.equal(
    serviceManagerSource.includes("com.zhipu"),
    false,
    "服务命名不得再出现厂商前缀 com.zhipu",
  );
});

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

async function walkSourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "out", ".git", "coverage", ".playwright"].includes(entry.name)) {
        continue;
      }
      files.push(...(await walkSourceFiles(fullPath)));
    } else if (
      (/\.[cm]?[jt]sx?$/.test(entry.name) || entry.name === ".env.example") &&
      !entry.name.includes(".test.")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

test("仓库源码不再出现 com.zhipu 厂商命名（除历史记录外）", async () => {
  const offenders: string[] = [];
  const roots = ["packages", "apps", "scripts", "e2e"].map((root) => join(REPO_ROOT, root));
  for (const root of roots) {
    if (
      !(await stat(root)
        .then(() => true)
        .catch(() => false))
    )
      continue;
    for (const file of await walkSourceFiles(root)) {
      const source = await readFile(file, "utf8");
      if (source.includes("com.zhipu")) {
        offenders.push(relative(REPO_ROOT, file));
      }
    }
  }
  assert.deepEqual(offenders, [], "com.zhipu 已随 P5 identity 切换移除，以上文件仍含厂商命名");
});

test("zcodeEndpointOrigin 仅允许出现在测试文件（P5 D-P5.4 硬切守卫）", async () => {
  const offenders: string[] = [];
  const roots = ["packages", "apps", "scripts", "e2e"].map((root) => join(REPO_ROOT, root));
  for (const root of roots) {
    if (
      !(await stat(root)
        .then(() => true)
        .catch(() => false))
    )
      continue;
    for (const file of await walkSourceFiles(root)) {
      const source = await readFile(file, "utf8");
      if (source.includes("zcodeEndpointOrigin")) {
        offenders.push(relative(REPO_ROOT, file));
      }
    }
  }
  assert.deepEqual(offenders, [], "zcodeEndpointOrigin 已删除，以上文件仍有残留引用");
});
