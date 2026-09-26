import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ProviderConfigMap, ProviderConfigResolver, type ProviderModel } from "@zcode/provider";
import { createProviderConfigRuntime } from "../src/model-provider/providerConfigRuntime.js";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";

// spec §1（P1.1/决策 A5）：GLM 能力元数据规则作为厂商平等内容恢复进目录
// modelConfigRules.modelRules，且保持 0ed9c86 的原始叠加顺序（前面的规则打底、
// 后面的规则覆盖：glm-5.3 1M 基础规则在前，glm-5.3-flash 视觉覆盖在后）。
// 本文件通过真实的 createPersonalProvider → ProviderConfigResolver 链路验证：
// bigmodel/zai 的模型列表端点只返回 id（probe 证据），这些目录规则是该家族
// 唯一正确的配置来源。modelMatch 匹配为大小写不敏感（model-config.ts matchesRule
// 第三参固定为 true），故大写 GLM-5.3 必须同样命中。

async function withResolvedModels(
  initialModelIds: readonly string[],
): Promise<readonly ProviderModel[]> {
  const dir = await mkdtemp(join(tmpdir(), "zcode-glm-capability-"));
  setDataBaseDir(dir);
  const configDir = getAppConfigDir();
  await mkdir(configDir, { recursive: true });
  const runtime = createProviderConfigRuntime({
    zcodeBuiltinFilePath: fileURLToPath(
      new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
    ),
    personalFilePath: join(configDir, "personal.json"),
    personalPollingIntervalMs: false,
    watch: false,
  });
  try {
    await runtime.start();
    const config = await runtime.configService.read();
    // 动态挑选 api-key 模板：能力规则按 modelId 匹配、与具体模板无关，
    // 但内置目录由其它 P1/P1.1 任务并发清洗，不把测试钉死在具体 templateId 上。
    const templateId = config.zcodeBuiltinProviderTemplates
      .entries()
      .find(
        ([, template]) =>
          template.config.access?.type === "api-key" && Boolean(template.config.api?.baseUrl),
      )?.[0];
    assert.ok(templateId, "内置目录必须保留至少一个 api-key + baseUrl 模板");

    const creation = await runtime.configService.createPersonalProvider({
      templateId,
      initialModelIds: [...initialModelIds],
    });
    const next = await runtime.configService.read();
    const resolution = new ProviderConfigResolver().resolve({
      zcodeBuiltinProviders: next.zcodeBuiltinProviders,
      zcodeBuiltinProviderTemplates: next.zcodeBuiltinProviderTemplates,
      personalProviders: next.personalProviders,
      zcodeBuiltinModelRules: next.zcodeBuiltinModelRules,
      personalModels: next.personalModels,
      accountProviders: ProviderConfigMap.empty(),
      personalProviderOrder: next.personalProviderOrder,
    });
    const created = resolution.resolvedProviders.find(
      (provider) => provider.providerId === creation.providerId,
    );
    assert.ok(created, "新建 provider 必须出现在解析结果中");
    return created.models;
  } finally {
    runtime.dispose();
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
}

test("glm-5.3 resolves the restored 1M context window from catalog modelRules", async () => {
  const models = await withResolvedModels(["glm-5.3"]);
  const model = models.find((entry) => entry.modelId === "glm-5.3");
  assert.ok(model);
  assert.equal(model.config.properties.contextWindow, 1_000_000);
});

test("glm-5.3-flash gains image, video and pdf input via the overlay rule", async () => {
  const models = await withResolvedModels(["glm-5.3-flash"]);
  const model = models.find((entry) => entry.modelId === "glm-5.3-flash");
  assert.ok(model);
  // 叠加顺序（A5 恢复时保持 0ed9c86 原序）：基础规则给 1M + 无视觉，
  // flash 覆盖规则只叠加 inputFormat，contextWindow 仍为 1M。
  assert.equal(model.config.properties.inputFormat.supportsImage, true);
  assert.equal(model.config.properties.inputFormat.supportsVideo, true);
  assert.equal(model.config.properties.inputFormat.supportsPdf, true);
  assert.equal(model.config.properties.contextWindow, 1_000_000);
});

test("uppercase GLM-5.3 matches the same capability rules (case-insensitive modelMatch)", async () => {
  const models = await withResolvedModels(["GLM-5.3"]);
  const model = models.find((entry) => entry.modelId === "GLM-5.3");
  assert.ok(model);
  assert.equal(model.config.properties.contextWindow, 1_000_000);
});

test("glm-4v-flash pins the exact restored capability data", async () => {
  const models = await withResolvedModels(["glm-4v-flash"]);
  const model = models.find((entry) => entry.modelId === "glm-4v-flash");
  assert.ok(model);
  // 钉死恢复数据本身（0ed9c86 原值：16384 窗口 + 视觉输入）。
  assert.equal(model.config.properties.inputFormat.supportsImage, true);
  assert.equal(model.config.properties.contextWindow, 16_384);
});
