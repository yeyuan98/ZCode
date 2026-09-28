/**
 * P5 导出种子（W4a 暂存，W4b 在其上构建 conversation-export 服务）。
 *
 * 从原 conversationShareService.loadAllRows 原样迁移：分页倒读全部会话行，
 * 校验翻页推进、全局 rowId 有序与读水位（logEpoch/revision）一致。
 * 本地导出是时点快照，读水位抖动必须显式失败而不是导出半新半旧的会话。
 */
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import { PROTOCOL_V4_LIMITS } from "@zcode/shared/zcode-protocol-v4";

import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import { throwConversationExportError } from "./conversationExportError.js";

/** 目标会话定位：与 workspaceIdentity 优先的身份口径保持一致。 */
interface ConversationRowsTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  sessionId: string;
}

interface ConversationRowsRead {
  rows: ConversationRow[];
  revision: number;
  logEpoch: string;
}

/** loadAllRows 只读 rowsRange；附件/文件能力属于已删除的分享预检面，不进入导出。 */
type ConversationRowsAgentService = Pick<IZCodeAgentService, "conversationRowsRangeV4">;

export async function loadAllRows(
  input: ConversationRowsTarget,
  agentService: ConversationRowsAgentService,
): Promise<ConversationRowsRead> {
  const pages: ConversationRow[][] = [];
  let beforeRowId: number | undefined;
  let logEpoch: string | undefined;
  let revision: number | undefined;

  while (true) {
    const result = await agentService.conversationRowsRangeV4({
      workspacePath: input.workspacePath,
      ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
      ...(input.remoteSessionId ? { remoteSessionId: input.remoteSessionId } : {}),
      sessionId: input.sessionId,
      ...(beforeRowId === undefined ? {} : { beforeRowId }),
      limit: PROTOCOL_V4_LIMITS.rowsRangeMaxLimit,
    });
    if (
      (logEpoch !== undefined && result.atLogEpoch !== logEpoch) ||
      (revision !== undefined && result.atRevision !== revision)
    ) {
      throwConversationExportError("invalid_conversation", "Conversation changed while reading");
    }
    logEpoch = result.atLogEpoch;
    revision = result.atRevision;
    pages.unshift(result.rows);
    if (!result.hasMore) break;
    const firstRowId = result.rows[0]?.rowId;
    if (firstRowId === undefined || firstRowId === beforeRowId) {
      throwConversationExportError(
        "invalid_contract",
        "Conversation row pagination did not advance",
      );
    }
    beforeRowId = firstRowId;
  }

  const rows = pages.flat();
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]!;
    const current = rows[index]!;
    if (previous.rowId >= current.rowId) {
      throwConversationExportError(
        "invalid_contract",
        "Conversation rows are not globally ordered",
      );
    }
  }
  if (logEpoch === undefined || revision === undefined) {
    throwConversationExportError(
      "invalid_contract",
      "Conversation rows are missing a read watermark",
    );
  }
  return { rows, revision, logEpoch };
}
