import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeZCodeBuiltinRelease } from "@zcode/provider-node";

// P1 目录不变量：厂商模板平等化为普通 api-key 条目、GLM 硬编码与账号体系清零、
// 新增无 access 的 ollama 本地模板。加载路径与应用运行时一致（readFile → decodeZCodeBuiltinRelease）。
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
  const release = decodeZCodeBuiltinRelease(JSON.parse(content));

  assert.equal(release.config.providerTemplates.keys().length, 21);
  assert.equal(release.config.providers.keys().length, 0);

  // P6 厂商清理门禁按原文大小写不敏感匹配，目录文本必须零命中。
  assert.equal(content.match(/glm/gi), null);
  assert.equal(content.includes("zhipu"), false);
  assert.equal(content.includes("account:"), false);
  assert.equal(content.includes("supportsNativeWebSearch"), false);

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
