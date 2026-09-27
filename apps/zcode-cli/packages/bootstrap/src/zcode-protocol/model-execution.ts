import type { CommandPayloadMap } from "@zcode/shared/zcode-protocol-v4";
import type { SendInputOptions } from "../app/types.js";

/** 两种输入协议共用执行材料投影；不把执行约束放入可持久化的 intent。
 *  P3：requestAuth（闲时票据鉴权）注入已删除——执行凭据完全由目标 Provider 常规配置解析。 */
export function createModelExecutionContext(
  input: NonNullable<CommandPayloadMap["sendText"]["modelExecution"]>,
): NonNullable<SendInputOptions["modelExecution"]> {
  return {
    ...(input.memoryExtraction ? { memoryExtraction: input.memoryExtraction } : {}),
    selectionScope: "execution",
    ...(input.subagents ? { subagents: input.subagents } : {}),
  };
}
