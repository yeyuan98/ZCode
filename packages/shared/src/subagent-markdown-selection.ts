import { decodeCustomModelValue, encodeCustomModelValue } from "./custom-model-value.js";
import { parseModelPickerValue, type ModelSelection } from "./model-selection.js";

const INHERIT_NAMES = new Set(["inherit", "main", "sonnet", "opus", "haiku"]);

/** Markdown 的正式字段始终为字符串 model + thoughtLevel；不解释中间态字段。 */
export function parseSubagentMarkdownSelection(
  frontmatter: Record<string, unknown>,
): ModelSelection | undefined {
  if (typeof frontmatter.model !== "string") return undefined;
  const value = frontmatter.model.trim();
  if (!value || INHERIT_NAMES.has(value)) return undefined;
  let selection: ModelSelection;
  const custom = decodeCustomModelValue(value);
  if (custom) {
    if (!custom.providerId.trim() || !custom.modelName?.trim()) return undefined;
    selection = { providerId: custom.providerId.trim(), modelId: custom.modelName.trim() };
  } else {
    try {
      selection = parseModelPickerValue(value);
    } catch {
      return undefined;
    }
  }
  const reasoningLevel =
    typeof frontmatter.thoughtLevel === "string" ? frontmatter.thoughtLevel.trim() : "";
  return reasoningLevel ? { ...selection, options: { reasoningLevel } } : selection;
}

// 旧 builtin: Provider 的 Markdown 改写迁移已随 GLM 历史 hard-cut 删除；本文件只剩解析与无损保存。

/** 普通 ID 保持可读；分隔符或 custom: 前缀会与解析格式冲突，须用既有编码无损保存。 */
export function formatSubagentMarkdownModel(selection: ModelSelection): string {
  return selection.providerId.startsWith("custom:") ||
    selection.providerId.includes("/") ||
    selection.modelId.includes("$")
    ? encodeCustomModelValue(selection.providerId, selection.modelId)
    : `${selection.providerId}/${selection.modelId}`;
}
