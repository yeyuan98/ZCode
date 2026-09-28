/**
 * P5 导出种子（W4a 暂存，W4b 在其上构建 conversation-export 服务）。
 *
 * 原 conversation-share 服务的跨 RPC 错误信封（requestId/issue 脱敏等）已随分享链路删除；
 * 本地 Markdown 导出只需要一个可区分「选择无效 / 契约破坏 / 会话状态失效」的错误类型。
 * W4b 扩展导出服务时如需跨 RPC 载荷，再在这里补充序列化形状。
 */
export type ConversationExportErrorKind =
  | "invalid_selection"
  | "invalid_contract"
  | "invalid_conversation";

export class ConversationExportError extends Error {
  readonly kind: ConversationExportErrorKind;

  constructor(kind: ConversationExportErrorKind, message: string) {
    super(message);
    this.name = "ConversationExportError";
    this.kind = kind;
  }
}

export function throwConversationExportError(
  kind: ConversationExportErrorKind,
  message: string,
): never {
  throw new ConversationExportError(kind, message);
}
