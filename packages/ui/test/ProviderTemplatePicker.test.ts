import assert from "node:assert/strict";
import test from "node:test";
import { resolveProviderTemplateGroups } from "../src/settings/model-provider-section/providerTemplateGroups.ts";

function template(templateId: string) {
  return {
    templateId,
    templateNameMap: { "zh-CN": templateId, "en-US": templateId },
    config: {},
  } as Parameters<typeof resolveProviderTemplateGroups>[0][number];
}

test("template picker groups all vendors into a single neutral list", () => {
  // P2：所有厂商平铺为单一列表，不再有 zhipu/other 厂商专属分组。
  const groups = resolveProviderTemplateGroups([
    template("zai-api"),
    template("bigmodel-standard-api"),
    template("openai"),
    template("anthropic"),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, "all");
  assert.deepEqual(
    groups[0].templates.map((item) => item.templateId),
    ["zai-api", "bigmodel-standard-api", "openai", "anthropic"],
  );
});

test("template picker grouping keeps original order for an empty catalog", () => {
  const groups = resolveProviderTemplateGroups([]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].templates, []);
});
