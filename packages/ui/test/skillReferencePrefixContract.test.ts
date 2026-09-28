import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { filterSkillsForProvider } from "../src/lib/skillSourceFilter.ts";

/**
 * 契约（specs/agent-identity-and-tooling-purge.md P4-D，Invariants）：
 *
 * skill-id 前缀是跨边界契约：CLI bootstrap 生产 `zcode:` 前缀，UI 过滤器消费。
 * 生产者（skill-reference-catalog.ts）与消费者（skillSourceFilter.ts）必须在同一次
 * 提交里原子翻转；这里同时锁定两侧，防止只改一端导致引用面板技能全部消失。
 */
test("skill 引用前缀契约：CLI 生产 zcode: 且 UI 过滤器只认 zcode:", async () => {
  const catalogSource = await readFile(
    new URL(
      "../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol/skill-reference-catalog.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(
    catalogSource.includes("id: `zcode:${scope}:${skill.path}`"),
    true,
    "CLI 生产端必须铸造 zcode: 前缀的 skill id",
  );
  assert.equal(catalogSource.includes("id: `glm:"), false, "CLI 生产端不应再铸造旧前缀 skill id");

  const zcodeSkill = {
    id: "zcode:user:example-skill",
    path: "/home/u/.zcode/skills/example-skill",
  };
  const legacySkill = { id: "glm:user:example-skill", path: "/tmp/legacy-skill" };
  const pluginSkill = {
    id: "zcode:plugin:p",
    path: "/home/u/.zcode/cli/plugins/cache/p",
    scope: "plugin",
  };
  const filtered = filterSkillsForProvider([zcodeSkill, legacySkill, pluginSkill], "zcode");
  assert.deepEqual(filtered, [zcodeSkill, pluginSkill]);
});
