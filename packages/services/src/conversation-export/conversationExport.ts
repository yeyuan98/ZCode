/**
 * P5 W4b：本地会话 Markdown 导出服务接口（D-P5.7：v1 整会话导出）。
 *
 * 接口/描述符保持 browser-safe（无 node:* 依赖），从 @zcode/services 根入口导出，
 * renderer 侧 RemoteServiceAccess 依赖它创建代理；实现见 conversationExportService.ts。
 */
import { ServiceChannels } from "@zcode/shared";

import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import { createServiceDescriptor } from "../descriptors.js";

/** 导出目标会话定位：与 workspaceIdentity 优先的身份口径保持一致。 */
export interface ConversationExportInput {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  sessionId: string;
}

export interface ConversationExportResult {
  markdown: string;
  /** `zcode-session-<slugified title or id>.md`；渲染端作为保存对话框的 suggestedName。 */
  fileName: string;
}

export interface IConversationExportService {
  exportConversation(input: ConversationExportInput): Promise<ConversationExportResult>;
}

export const IConversationExportService = createServiceDescriptor<IConversationExportService>(
  ServiceChannels.ConversationExport,
);

/** 与 seed conversationRowLoading 相同的 V4 agent 只读 pick。 */
export type ConversationExportAgentService = Pick<IZCodeAgentService, "conversationRowsRangeV4">;

/**
 * Host attachment 装配用的 connection-scope 工厂。
 *
 * conversationRowsRangeV4 要求 trusted-carrier 连接上下文；直接持有 raw Agent 的服务
 * 在 rowsRange 上会被 `fault.conversation.rowsRangeConnectionUntrusted` 拒绝。Host 在
 * exposeServicePort / setupChannelServer 时用当前 MessagePort/WebSocket 的 scoped Agent
 * 生成绑定该连接的导出服务。Symbol method 不可由 string-command ProxyChannel 调用，
 * 仅限 Host 装配（沿用原 conversationShareConnectionScopeFactory 的纪律）。
 */
export const conversationExportConnectionScopeFactory = Symbol(
  "conversationExportConnectionScopeFactory",
);

export interface ConnectionScopableConversationExportService extends IConversationExportService {
  [conversationExportConnectionScopeFactory](
    agentService: ConversationExportAgentService,
  ): IConversationExportService;
}

export function isConnectionScopableConversationExportService(
  service: IConversationExportService,
): service is ConnectionScopableConversationExportService {
  return (
    conversationExportConnectionScopeFactory in service &&
    typeof service[conversationExportConnectionScopeFactory] === "function"
  );
}

/**
 * 把导出服务绑定到当前 attachment 的 scoped Agent；scope 缺席时保持原服务
 * （远端 host 自带 carrier 注入，或极端无 Agent 场景由调用方报错）。
 */
export function scopeConversationExportServiceForConnection(
  service: IConversationExportService,
  agentService: ConversationExportAgentService | undefined,
): IConversationExportService {
  if (!agentService || !isConnectionScopableConversationExportService(service)) {
    return service;
  }
  return service[conversationExportConnectionScopeFactory](agentService);
}
