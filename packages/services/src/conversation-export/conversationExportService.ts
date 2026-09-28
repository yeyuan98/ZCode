/**
 * P5 W4b：本地会话 Markdown 导出服务（specs/conversation-export.md）。
 *
 * 时点快照语义：分页倒读全部行（loadAllRows）+ 在役守卫（运行中轮次/流式行/活跃
 * 工具/子代理 → conversation_running），格式化为 Markdown 返回。全本地、无网络。
 * 标题经 zcodeSessionService.readSession(messageLimit:1) 轻量读取；失败回落 sessionId。
 */
import type { IZCodeSessionService } from "#src/zcode-session/zcodeSession.js";
import { createServiceLogger, type ServiceLogger } from "#src/logger/serviceLogger.js";

import {
  ConversationExportError,
  throwConversationExportError,
} from "./conversationExportError.js";
import {
  conversationExportConnectionScopeFactory,
  type ConversationExportAgentService,
  type ConversationExportInput,
  type ConversationExportResult,
  type IConversationExportService,
} from "./conversationExport.js";
import { loadAllRows } from "./conversationRowLoading.js";
import {
  collectShareStructureIssues,
  type ConversationStructureIssueCode,
} from "./conversationStructureIssues.js";
import { formatConversationExportV1 } from "./sharedContextFormatter.js";

/** 在役守卫取结构问题中「运行中内容未定稿」子集；unsafe_url/artifact_protocol_not_ready 是公开投影安全语义，本地导出忽略。 */
const BLOCKING_EXPORT_ISSUE_CODES: ReadonlySet<ConversationStructureIssueCode> = new Set([
  "running_turn",
  "streaming_row",
  "active_tool_call",
  "active_subagent",
  "unsupported_timeline",
]);

const FILE_NAME_MAX_SLUG_LENGTH = 80;

interface ConversationExportServiceDependencies {
  zcodeAgentService: ConversationExportAgentService;
  zcodeSessionService?: Pick<IZCodeSessionService, "readSession">;
  logger?: ServiceLogger;
}

function slugifySessionFileNamePart(value: string): string {
  const forbidden = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);
  const slug = [...value.normalize("NFKC").trim()]
    .map((character) =>
      character.codePointAt(0)! < 32 || forbidden.has(character) ? " " : character,
    )
    .join("")
    .replace(/\s+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, FILE_NAME_MAX_SLUG_LENGTH)
    .replace(/-+$/gu, "");
  return slug;
}

export class ConversationExportService implements IConversationExportService {
  private readonly zcodeAgentService: ConversationExportAgentService;
  private readonly zcodeSessionService: Pick<IZCodeSessionService, "readSession"> | undefined;
  private readonly logger: ServiceLogger;

  constructor(dependencies: ConversationExportServiceDependencies) {
    this.zcodeAgentService = dependencies.zcodeAgentService;
    this.zcodeSessionService = dependencies.zcodeSessionService;
    this.logger = dependencies.logger ?? createServiceLogger("conversation-export");
  }

  /** Host attachment 内部 facade：复用同一业务服务，只替换 V4 Rows 查询的可信 Agent scope。 */
  [conversationExportConnectionScopeFactory](
    agentService: ConversationExportAgentService,
  ): IConversationExportService {
    return new ConversationExportService({
      zcodeAgentService: agentService,
      zcodeSessionService: this.zcodeSessionService,
      logger: this.logger,
    });
  }

  async exportConversation(input: ConversationExportInput): Promise<ConversationExportResult> {
    if (!input.sessionId.trim()) {
      throwConversationExportError("invalid_contract", "Session id is required");
    }
    const { rows } = await loadAllRows(input, this.zcodeAgentService);

    const blockingIssues = collectShareStructureIssues(rows).filter((issue) =>
      BLOCKING_EXPORT_ISSUE_CODES.has(issue.code),
    );
    if (blockingIssues.length > 0) {
      // 导出是时点快照：运行中内容未定稿时显式拒绝，而不是导出半新半旧的会话。
      throw new ConversationExportError(
        "conversation_running",
        `Conversation is still running: ${blockingIssues.map((issue) => issue.code).join(", ")}`,
      );
    }

    const title = await this.resolveSessionTitle(input);
    const document = formatConversationExportV1({ title: title || input.sessionId, rows });
    if (document.unsupportedKinds.length > 0) {
      this.logger.warn(undefined, "[conversation-export] 存在未渲染的 row kind", {
        sessionId: input.sessionId,
        unsupportedKinds: document.unsupportedKinds,
      });
    }
    this.logger.info(undefined, "[conversation-export] 会话导出完成", {
      sessionId: input.sessionId,
      rowCount: rows.length,
      markdownSha256: document.markdownSha256,
      titleResolved: Boolean(title),
    });
    const slug = slugifySessionFileNamePart(title) || slugifySessionFileNamePart(input.sessionId);
    return { markdown: document.markdown, fileName: `zcode-session-${slug}.md` };
  }

  /** 标题只影响文件名展示；读取失败回落 sessionId，不阻断导出。 */
  private async resolveSessionTitle(input: ConversationExportInput): Promise<string> {
    if (!this.zcodeSessionService) return "";
    try {
      const snapshot = await this.zcodeSessionService.readSession({
        workspacePath: input.workspacePath,
        ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
        ...(input.remoteSessionId ? { remoteSessionId: input.remoteSessionId } : {}),
        sessionId: input.sessionId,
        // messageLimit<=0 在 agent 侧表示「不限」——大 session 会整段投影消息；
        // 导出只需要 session.title，取 1 条消息保持轻量。
        messageLimit: 1,
      });
      return snapshot.session.title.trim();
    } catch (error) {
      this.logger.warn(undefined, "[conversation-export] 会话标题读取失败，文件名回落 sessionId", {
        sessionId: input.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return "";
    }
  }
}

export function createConversationExportService(
  dependencies: ConversationExportServiceDependencies,
): IConversationExportService {
  return new ConversationExportService(dependencies);
}
