/**
 * P5 W4b：本地会话 Markdown 导出的错误类型。
 *
 * 原 conversation-share 服务的跨 RPC 错误信封（requestId/issue 脱敏等）已随分享链路删除；
 * 本地导出只需要区分「会话仍在运行（时点快照语义）/ 选择无效 / 契约破坏 / 会话状态失效」。
 * RPC 框架的 PromiseError 透传键包含 `kind`（packages/rpc ChannelServer/ChannelClient
 * passthroughKeys），因此渲染端可用 readConversationExportErrorKind 从还原的 Error 上
 * 读回分类，给出可操作的 toast 文案。
 */
export type ConversationExportErrorKind =
  | "conversation_running"
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

/**
 * 读取跨 RPC 还原的导出错误分类；非导出错误返回 undefined。
 * 渲染端只依赖该分类选择文案，不解析 message。
 */
export function readConversationExportErrorKind(
  error: unknown,
): ConversationExportErrorKind | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const kind = (error as { kind?: unknown }).kind;
  if (typeof kind !== "string") return undefined;
  return (CONVERSATION_EXPORT_ERROR_KINDS as readonly string[]).includes(kind)
    ? (kind as ConversationExportErrorKind)
    : undefined;
}

const CONVERSATION_EXPORT_ERROR_KINDS: readonly ConversationExportErrorKind[] = [
  "conversation_running",
  "invalid_selection",
  "invalid_contract",
  "invalid_conversation",
];
