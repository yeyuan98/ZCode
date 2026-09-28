/**
 * P5 导出种子（W4a 暂存；W4b 的 v1 导出为整会话导出，本文件暂无调用方）。
 *
 * 从原 conversationShareService.selectRows 迁移：把「全部 / 按轮 / 按行」三种选择
 * 归一为有序 productTurnIds + 过滤后的行集。选择语义按 D-P5.7 推迟到 v2；
 * 保留在这里作为 v2 轮次选择（及校验纪律：缺 turnHeader、重复 header、静默丢行
 * 必须显式拒绝）的种子，避免届时从 git 历史里捞。
 */
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";

import { throwConversationExportError } from "./conversationExportError.js";

/** 中性的行选择描述；取代已随选择 UI 删除的 ConversationShareSelection。 */
export type ConversationRowSelection =
  | { kind: "all" }
  | { kind: "productTurns"; productTurnIds: string[] }
  | { kind: "rowAnchors"; rowIds: number[] };

export function selectRows(
  rows: ConversationRow[],
  selection: ConversationRowSelection,
): { rows: ConversationRow[]; productTurnIds: string[] } {
  let selectedProductTurnIds: Set<string>;
  if (selection.kind === "all") {
    selectedProductTurnIds = new Set(
      rows
        .filter((row) => row.kind === "turnHeader")
        .map((row) => row.productTurnId)
        .filter((value): value is string => value !== undefined),
    );
  } else if (selection.kind === "productTurns") {
    if (selection.productTurnIds.length === 0) {
      throwConversationExportError(
        "invalid_selection",
        "At least one product turn must be selected",
      );
    }
    selectedProductTurnIds = new Set(selection.productTurnIds);
  } else {
    if (selection.rowIds.length === 0) {
      throwConversationExportError(
        "invalid_selection",
        "At least one conversation row must be selected",
      );
    }
    const rowsById = new Map(rows.map((row) => [row.rowId, row]));
    selectedProductTurnIds = new Set<string>();
    for (const rowId of new Set(selection.rowIds)) {
      const row = rowsById.get(rowId);
      if (!row?.productTurnId) {
        throwConversationExportError("invalid_selection", "A selected row no longer exists");
      }
      selectedProductTurnIds.add(row.productTurnId);
    }
  }

  const orderedProductTurnIds: string[] = [];
  const headerCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== "turnHeader" || !row.productTurnId) continue;
    headerCounts.set(row.productTurnId, (headerCounts.get(row.productTurnId) ?? 0) + 1);
    if (selectedProductTurnIds.has(row.productTurnId)) {
      orderedProductTurnIds.push(row.productTurnId);
    }
  }
  if (
    orderedProductTurnIds.length === 0 ||
    orderedProductTurnIds.length !== selectedProductTurnIds.size ||
    orderedProductTurnIds.some((productTurnId) => headerCounts.get(productTurnId) !== 1)
  ) {
    throwConversationExportError(
      "invalid_selection",
      "Selected product turns are incomplete or ambiguous",
    );
  }

  const selectedTurnIds = new Set(
    rows
      .filter(
        (row) =>
          row.kind === "turnHeader" &&
          row.productTurnId !== undefined &&
          selectedProductTurnIds.has(row.productTurnId),
      )
      .map((row) => row.turnId),
  );

  return {
    productTurnIds: orderedProductTurnIds,
    // 旧投影可能缺 productTurnId；只要 turnId 落在已选轮次也必须保留，让校验显式拒绝，
    // 不能在过滤时静默丢行后导出一份不完整会话。
    rows: rows.filter(
      (row) =>
        (row.productTurnId !== undefined && selectedProductTurnIds.has(row.productTurnId)) ||
        (row.productTurnId === undefined && selectedTurnIds.has(row.turnId)),
    ),
  };
}
