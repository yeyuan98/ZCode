import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ZCODE_AGENT_PROVIDER } from "../src/zcode-agent-policy.ts";
import { ZCODE_AGENT_RUNTIME } from "../src/zcode-agent-runtime.ts";
import { zcodeProviderSchema } from "../src/providers.ts";
import type { ZCodeAgentModelStateUpdate } from "../src/zcode-task-types-core.ts";

/**
 * 契约（specs/agent-identity-and-tooling-purge.md P4-D，Invariants）：
 *
 * provider 字面量只允许存在两个源码位点（providers.ts 枚举 + task-types 内联类型），
 * 且必须在同一次提交里翻转；运行时身份（policy、descriptor）、任务事件值与 UI 过滤
 * 契约全部由这些单一真源派生。这里锁定重命名后的不变量，防止后续改动把旧身份
 * 或第三个字面量带回来。
 */
test("agent provider 身份不变量：枚举/policy/descriptor 均为 zcode", () => {
  assert.equal(ZCODE_AGENT_PROVIDER, "zcode");
  assert.equal(zcodeProviderSchema.parse("zcode"), "zcode");
  assert.equal(zcodeProviderSchema.safeParse("glm").success, false);
});

test("agent runtime descriptor 不变量：binaryEnvVar 与 bundledResourceDir 与打包链路锁定", () => {
  assert.equal(ZCODE_AGENT_RUNTIME.binaryEnvVar, "ZCODE_AGENT_BINARY_PATH");
  assert.equal(ZCODE_AGENT_RUNTIME.bundledResourceDir, "zcode");
});

test("task 事件字面量 zcode_agent_model_state_update 存在于 task-types 源码", async () => {
  const taskTypesSource = await readFile(
    new URL("../src/zcode-task-types-core.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    taskTypesSource.includes('"zcode_agent_model_state_update"'),
    true,
    "task 事件 type 字面量必须存在于 zcode-task-types-core.ts",
  );
  // 类型导入同时校验事件接口本身可被消费方引用（ZCodeGlmAgent* 已重命名为中性名）。
  const _event: Pick<ZCodeAgentModelStateUpdate, "type"> = {
    type: "zcode_agent_model_state_update",
  };
  assert.equal(_event.type, "zcode_agent_model_state_update");
});
