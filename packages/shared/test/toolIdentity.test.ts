import assert from "node:assert/strict";
import test from "node:test";
import {
  ZCODE_KNOWN_TOOL_NAMES,
  getZCodeToolFamilyForName,
  normalizeZCodeToolName,
} from "../src/tool-identity.ts";

/**
 * 契约（specs/agent-identity-and-tooling-purge.md P4）：
 *
 * WebSearch 工具与 `web_search` 别名已端到端删除，已知工具名里不得再出现；
 * 但 `"search"` 工具家族本身保留，Glob / Grep / WebFetch 仍归属该家族
 * （PermissionDialog 与工具行的 search renderer 依赖它）。
 */
test("ZCODE_KNOWN_TOOL_NAMES 不再包含 WebSearch / web_search（P4 删除）", () => {
  const knownNames = [...ZCODE_KNOWN_TOOL_NAMES];
  assert.equal(
    knownNames.includes("WebSearch"),
    false,
    "WebSearch 已在 P4 删除，不应出现在已知工具名列表",
  );
  assert.equal(
    knownNames.includes("web_search"),
    false,
    "web_search 别名已在 P4 删除，不应出现在已知工具名列表",
  );
});

test('"search" 家族保留：Glob / Grep / WebFetch 仍映射到 search', () => {
  for (const toolName of ["Glob", "Grep", "WebFetch"] as const) {
    assert.equal(normalizeZCodeToolName(toolName), toolName);
    assert.equal(
      getZCodeToolFamilyForName(toolName),
      "search",
      `${toolName} 必须继续归属 "search" 家族`,
    );
  }
  assert.equal(getZCodeToolFamilyForName("WebSearch"), null);
  assert.equal(getZCodeToolFamilyForName("web_search"), null);
});
