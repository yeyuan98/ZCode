/**
 * P5 导出种子（W4a 暂存，W4b 在其上构建 conversation-export 服务）。
 *
 * 从原 conversationShareService.collectShareStructureIssues 迁移：扫描会话行的
 * 结构性问题（缺 product turn、运行中轮次/流式行/活跃工具/子代理、运行中时间线、
 * 本地 URL、未闭合 artifact 引用）。W4b 的导出在役守卫（in-flight guard）取其
 * 「运行中内容未定稿」子集；unsafe_url / artifact_protocol_not_ready 是公开投影
 * 安全语义，本地导出可按需忽略对应条目。
 */
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";

export type ConversationStructureIssueCode =
  | "missing_product_turn"
  | "running_turn"
  | "streaming_row"
  | "active_tool_call"
  | "active_subagent"
  | "unsupported_timeline"
  | "unsafe_url"
  | "artifact_protocol_not_ready";

export interface ConversationStructureIssue {
  code: ConversationStructureIssueCode;
  scope: "conversation" | "turn";
  rowId?: number;
  /** 展示用序号；轮次定位必须按 productTurnId，见原分享预检的错位教训。 */
  turnOrdinal?: number;
  productTurnId?: string;
}

function turnOrdinalByProductTurn(rows: readonly ConversationRow[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== "turnHeader" || !row.productTurnId || result.has(row.productTurnId)) continue;
    result.set(row.productTurnId, result.size + 1);
  }
  return result;
}

function rowTurnOrdinal(row: ConversationRow, ordinals: Map<string, number>): number | undefined {
  return row.productTurnId ? ordinals.get(row.productTurnId) : undefined;
}

function hasUnsafeShareString(value: unknown): boolean {
  if (typeof value === "string") return /^(?:data|file):/iu.test(value);
  if (Array.isArray(value)) return value.some(hasUnsafeShareString);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) =>
    key === "ref" ? false : hasUnsafeShareString(entry),
  );
}

function hasUnsupportedArtifactReference(value: unknown): boolean {
  if (typeof value === "string") return /^zcode-artifact:\/\//iu.test(value);
  if (Array.isArray(value)) return value.some(hasUnsupportedArtifactReference);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) =>
    key === "ref" ? false : hasUnsupportedArtifactReference(entry),
  );
}

export function collectShareStructureIssues(
  rows: readonly ConversationRow[],
  ordinalRows: readonly ConversationRow[] = rows,
): ConversationStructureIssue[] {
  const issues: ConversationStructureIssue[] = [];
  const ordinals = turnOrdinalByProductTurn(ordinalRows);
  const add = (row: ConversationRow, code: ConversationStructureIssueCode) => {
    issues.push({
      code,
      scope: code === "missing_product_turn" ? "conversation" : "turn",
      ...(row.rowId === undefined ? {} : { rowId: row.rowId }),
      ...(rowTurnOrdinal(row, ordinals) === undefined
        ? {}
        : { turnOrdinal: rowTurnOrdinal(row, ordinals) }),
      ...(row.productTurnId ? { productTurnId: row.productTurnId } : {}),
    });
  };
  for (const row of rows) {
    if (!row.productTurnId) add(row, "missing_product_turn");
    if (row.kind === "turnHeader" && row.state === "running") add(row, "running_turn");
    if ((row.kind === "assistantText" || row.kind === "reasoning") && row.state === "streaming") {
      add(row, "streaming_row");
    }
    if (
      row.kind === "toolCall" &&
      (row.status === "inputStreaming" ||
        row.status === "pendingApproval" ||
        row.status === "running")
    ) {
      add(row, "active_tool_call");
    }
    if (row.kind === "subagent" && row.status === "running") add(row, "active_subagent");
    if (row.kind === "timelineMarker") {
      // 只有「运行中」的时间线操作仍未定稿；fork/checkpoint/compact summaryRef 类
      // 已定稿结构在导出时由格式化器决定渲染或以 notice 跳过。
      if (
        (row.marker.type === "compact" && row.marker.status === "running") ||
        (row.marker.type === "goalVerify" && row.marker.outcome === "running")
      ) {
        add(row, "unsupported_timeline");
      }
    }
    if (hasUnsafeShareString(row)) add(row, "unsafe_url");
    if (hasUnsupportedArtifactReference(row)) add(row, "artifact_protocol_not_ready");
  }
  return issues;
}
