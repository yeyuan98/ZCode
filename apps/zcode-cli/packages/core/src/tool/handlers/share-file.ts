// ============================================================
// share_file Tool Handler
// ============================================================
// bot 会话（微信私聊）里模型用它把工作区文件作为原生媒体消息发给聊天用户：
//   - 工具只在注入了 BotFileSharePort 的会话注册（bot 会话 force-yolo，无审批流；
//     普通会话永远看不到这个工具）。
//   - 收件人由 Host 从 taskDeliveryRegistry 解析，模型只能给 path。
//   - 结局永远如实回给模型：成功报告文件名与字节数；每种失败原因都有对应的
//     英文说明；unknown-outcome 显式告知模型结果未知、请用户在聊天里确认。
// 两支都是普通工具结果（不是 ToolHandlerFailure）：失败大多不可通过重试修复，
// 渲染成错误只会让模型反复撞同一堵墙；由模型基于真实结局组织回复。

import {
  CoreErrorType,
  SHARE_FILE_TOOL_NAME,
  ShareFileInputJsonSchema,
  ShareFileInputSchema,
  ShareFileOutputJsonSchema,
  ShareFileOutputSchema,
  createCoreError,
  type ShareFileInput,
  type ShareFileOutput,
} from "@zcode/contracts";
import type { ToolEntry, ToolHandler } from "../types.js";

// 端口 RPC 超时是 300s（见 bootstrap 的 bot-file-share-port）；工具墙钟必须更高，
// 保证先由端口把超时映射成 unknown-outcome，而不是被通用工具超时截断成无信息失败。
const SHARE_FILE_TOOL_TIMEOUT_MS = 330_000;
const SHARE_FILE_MODEL_BYTES = 8_000;

const SHARE_FILE_DESCRIPTION = [
  "Send a file from the workspace to the user in the bot chat as a native media message (image/video/file).",
  "",
  "Only available in bot chat sessions (WeChat private chat); the tool result reports the REAL outcome, including exactly why a delivery failed.",
  "`path` must be a workspace-relative path or a path inside the workspace; paths outside the workspace are rejected.",
  "The recipient is always the user of this bot chat; you cannot choose or override it.",
].join("\n");

const shareFileHandler: ToolHandler = async (input, context) => {
  const parsed = ShareFileInputSchema.parse(input) as ShareFileInput;

  // Gate 与 escalate/submit_result 同款：以端口存在为判据。本工具只在注入了端口的
  // 会话注册，走到这里就是接线故障，不是一种业务结局。
  if (!context.botFileSharePort) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      "Bot file share port is not configured for share_file",
      {
        context: {
          toolCallId: context.toolCallId,
          toolName: SHARE_FILE_TOOL_NAME,
        },
        recoverable: false,
      },
    );
  }

  return (await context.botFileSharePort.share(parsed.path)) satisfies ShareFileOutput;
};

export const shareFileToolEntry: ToolEntry = {
  capability: "Share a workspace file with the bot chat user as a native media message",
  metadata: {
    name: SHARE_FILE_TOOL_NAME,
    description: SHARE_FILE_DESCRIPTION,
    readOnly: false,
    destructive: false,
    // 两次连续 share_file 是两条独立消息（宿主单一投递写者保证各恰好一次），可并行。
    concurrentSafe: true,
    timeoutMs: SHARE_FILE_TOOL_TIMEOUT_MS,
    maxOutputBytes: SHARE_FILE_MODEL_BYTES,
    // 外部副作用：经 provider API 出站投递，不是 workspace 内变更。
    sideEffectScope: "network",
    riskLevel: "medium",
    // bot 会话 force-yolo；普通会话不注册该工具，也不存在审批窗。
    needsApproval: false,
    providerVisible: true,
  },
  handler: shareFileHandler,
  formatModelContent: formatShareFileModelContent,
  inputSchema: ShareFileInputJsonSchema,
  outputSchema: ShareFileOutputJsonSchema,
  runtimeInputSchema: ShareFileInputSchema,
  runtimeOutputSchema: ShareFileOutputSchema,
  permission: {
    permission: "bots.shareFile",
    reason: "share_file sends a workspace file to the bot chat user via the host delivery pipeline",
    riskLevel: "medium",
    sideEffectScope: "network",
    needsApproval: false,
    patternSources: ["toolName"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: SHARE_FILE_MODEL_BYTES,
    maxModelBytes: SHARE_FILE_MODEL_BYTES,
    strategy: "truncate",
    preview: {
      maxBytes: SHARE_FILE_MODEL_BYTES,
      direction: "head",
    },
  },
  timeout: {
    defaultMs: SHARE_FILE_TOOL_TIMEOUT_MS,
    maxMs: SHARE_FILE_TOOL_TIMEOUT_MS,
    allowCallOverride: false,
  },
  cancellation: {
    supported: true,
    cleanup: "none",
    userVisibleMessage: "share_file was cancelled before the delivery outcome was known",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};

/** 模型只读到一段如实英文：成功带文件名与字节数；失败按原因给出可行动说明。 */
function formatShareFileModelContent(output: unknown): string {
  const parsed = ShareFileOutputSchema.safeParse(output);
  if (!parsed.success) return "share_file returned an invalid result.";
  const result = parsed.data;
  if (result.ok) {
    return `File sent to the bot chat user: ${result.filename} (${result.sizeBytes} bytes). They should have received it as a native media message.`;
  }
  const detail = result.detail ? ` Detail: ${result.detail}` : "";
  switch (result.reason) {
    case "no-target":
      return "No active bot chat target for this session, so nothing was sent. Do not retry; tell the user the file could not be delivered to the chat.";
    case "not-allowed":
      return `The bot or the user is not currently allowed to receive files (bot disabled, user unbound, file command turned off, or not a private chat), so nothing was sent.${detail}`;
    case "unsupported-provider":
      return "This chat provider cannot receive file messages yet, so nothing was sent.";
    case "remote-workspace":
      // Phase C Alpha 2 后新 host 已支持远程投递；该 reason 只会来自旧 host——如实说明
      // 是宿主版本问题，升级宿主即可获得远程投递。
      return "This session runs in a remote workspace and this host version does not support fetching files from remote workspaces yet, so nothing was sent. Updating the host app adds remote file delivery.";
    case "remote-unavailable":
      // 远程取回失败（不可达/初始化失败/超时/超预算/中途 RPC 失败）：只陈述结局并引导
      // 用户重连或稍后重试，不臆测具体故障点。
      return `The remote workspace could not be reached to fetch the file, so nothing was sent. Ask the user to reconnect the remote workspace (e.g. send /重连) or retry later.${detail}`;
    case "outside-workspace":
      return `The path is outside the workspace, so nothing was sent. Use a workspace-relative path.${detail}`;
    case "not-found":
      return `The file was not found, so nothing was sent. Check the path.${detail}`;
    case "too-large":
      return "The file exceeds the 5 MB delivery limit, so nothing was sent.";
    case "quota-exceeded":
      return "The file-sending quota for this chat is exhausted, so nothing was sent. Suggest the user request the file with the /file command, which is not quota-bound.";
    case "send-failed":
      // Review 修复（honest prose）：-32602/-32603 等 Host 侧错误（如投递前配置 IO 失败）
      // 从未触达 provider——不能断言失败发生在哪一侧。只陈述结局，引导模型如实报告
      // 并转介 /file（/file 不受 tool 配额限制）。
      return `The delivery attempt failed and the user did not receive the file. Tell the user the file could not be delivered, and suggest requesting it with the /file command instead.${detail}`;
    case "unsupported-method":
      return "The host does not support file sharing yet (it returned method not found), so nothing was sent.";
    case "unknown-outcome":
      return "The delivery outcome is UNKNOWN: the request timed out and the file may or may not have been sent. Do NOT claim success or failure. Ask the user to check the chat, and do not retry the same file immediately.";
    default: {
      // 穷尽检查：shared 新增 reason 时这里编译期报错，防止模型读到无说明的失败。
      const exhaustiveReason: never = result.reason;
      return `share_file failed: ${exhaustiveReason}${detail}`;
    }
  }
}
