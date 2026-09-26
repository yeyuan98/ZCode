import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeZCodeBuiltinRelease } from "@zcode/provider-node";

// P1 目录不变量：厂商模板平等化为普通 api-key 条目、账号体系清零、新增无 access 的
// ollama 本地模板。P1.1/A5：GLM 能力元数据规则作为厂商平等内容恢复进 modelRules
// （spec §1：glm 仅允许出现在 modelMatch 模式与能力属性内）。加载路径与应用运行时一致
// （readFile → decodeZCodeBuiltinRelease）。
const catalogPath = fileURLToPath(
  new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
);

const VENDOR_TEMPLATE_IDS = [
  "zai-api",
  "zai-standard-api",
  "bigmodel-api",
  "bigmodel-standard-api",
] as const;

test("builtin catalog keeps 21 templates with vendor-free invariants", async () => {
  const content = await readFile(catalogPath, "utf8");
  const parsed = JSON.parse(content) as {
    readonly config: {
      readonly modelConfigRules: {
        readonly modelRules: readonly {
          readonly modelMatch: string;
          readonly config?: {
            readonly properties?: { readonly contextWindow?: number };
          };
        }[];
        readonly templateModelRules: readonly unknown[];
        readonly builtinProviderModelRules: readonly unknown[];
      };
    };
  };
  const release = decodeZCodeBuiltinRelease(parsed);

  assert.equal(release.config.providerTemplates.keys().length, 21);
  assert.equal(release.config.providers.keys().length, 0);

  // P6 厂商清理门禁按原文大小写不敏感匹配，目录文本必须零命中。
  // P1.1/A5 精化：glm 允许作为厂商平等的能力元数据出现在 modelRules 内
  // （modelMatch 模式 + 能力属性），其余位置一律禁止。证明方式：深度克隆目录、
  // 将所有 modelRules[].modelMatch 置空后重新序列化——若任何 glm 字符串残留在
  // modelMatch 之外（含能力属性、模板、站点规则等），此断言即失败。
  const glmScoped = structuredClone(parsed);
  for (const rule of glmScoped.config.modelConfigRules.modelRules) {
    rule.modelMatch = null as unknown as string;
  }
  assert.equal(JSON.stringify(glmScoped).match(/glm/gi), null);

  // zhipu / account: / supportsNativeWebSearch 在目录内任何位置都不允许出现。
  assert.equal(content.includes("zhipu"), false);
  assert.equal(content.includes("account:"), false);
  assert.equal(content.includes("supportsNativeWebSearch"), false);

  // templateModelRules 与 builtinProviderModelRules 子树保持 glm-free（A5 边界）。
  assert.equal(
    JSON.stringify(parsed.config.modelConfigRules.templateModelRules).match(/glm/gi),
    null,
  );
  assert.equal(
    JSON.stringify(parsed.config.modelConfigRules.builtinProviderModelRules).match(/glm/gi),
    null,
  );

  // A5：61 条存活的厂商能力规则 + 24 条恢复的 GLM 能力规则（0ed9c86 原始顺序）。
  const modelRules = parsed.config.modelConfigRules.modelRules;
  assert.equal(modelRules.length, 84);
  const glmBase = modelRules.find(
    (rule) => rule.modelMatch === ".*glm-5\\.3(?:-flash)?(?:[.\\-:/\\[].*)?",
  );
  assert.ok(glmBase, "缺少 glm-5.3 基础能力规则");
  assert.equal(glmBase.config?.properties?.contextWindow, 1_000_000);

  for (const templateId of VENDOR_TEMPLATE_IDS) {
    const template = release.config.providerTemplates.get(templateId);
    assert.ok(template, `missing vendor template: ${templateId}`);
    assert.equal(template.config.access?.type, "api-key");
    assert.equal(template.config.builtinModelIds, undefined);
  }
});

test("ollama template runs unauthenticated openai-compatible local inference", async () => {
  const content = await readFile(catalogPath, "utf8");
  const release = decodeZCodeBuiltinRelease(JSON.parse(content));
  const ollama = release.config.providerTemplates.get("ollama");

  assert.ok(ollama);
  // 无 access 块：向导跳过密钥步骤，本地发现免鉴权。
  assert.equal(ollama.config.access, undefined);
  assert.equal(ollama.config.api?.type, "openai-chat-completions");
  assert.equal(ollama.config.api?.baseUrl, "http://localhost:11434/v1");
  assert.equal(ollama.config.builtinModelIds, undefined);
});
