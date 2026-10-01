// ============================================================
// share_file Tool - conversational bot file delivery
// ============================================================
// Bot 会话（微信私聊）里模型用它把工作区文件发给聊天对端。输入只有 `path`：
// 刻意没有 caption、没有收件人字段——收件人由 Host 从 taskDeliveryRegistry 解析，
// 模型工具参数不直接暴露（packages/shared/src/bots.ts 顶部契约注释同款约束）。

import { z } from "zod";
import { SHARE_FILE_TOOL_NAME } from "@zcode/shared";
import { toToolJsonSchema } from "./json-schema.js";

export { SHARE_FILE_TOOL_NAME };

export const ShareFileInputSchema = z
  .object({
    path: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Workspace-relative path (or a path inside the workspace) of the file to send to the bot chat user.",
      ),
  })
  .strict();

export type ShareFileInput = z.infer<typeof ShareFileInputSchema>;

export const ShareFileInputJsonSchema = toToolJsonSchema(ShareFileInputSchema);

// 与 @zcode/shared 的 botShareFileResultSchema 结构镜像同步（contracts 是 zod v3，
// shared 是 zod v4，不能直接复用实例；形状漂移由 shared 侧协议测试兜底）。
export const BOT_SHARE_FILE_FAILURE_REASONS = [
  "no-target",
  "not-allowed",
  "unsupported-provider",
  // "remote-workspace" 仅为旧 host 兼容保留（新 host 已支持远程投递，不再产生该 reason）。
  "remote-workspace",
  // Phase C Alpha 2：远程取回失败（远端不可达/初始化失败/超时/超预算/中途 RPC 失败）。
  "remote-unavailable",
  "outside-workspace",
  "not-found",
  "too-large",
  "quota-exceeded",
  "send-failed",
  "unsupported-method",
  "unknown-outcome",
] as const;

export const ShareFileOutputSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      filename: z.string().min(1),
      sizeBytes: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      reason: z.enum(BOT_SHARE_FILE_FAILURE_REASONS),
      detail: z.string().optional(),
    })
    .strict(),
]);

export type ShareFileOutput = z.infer<typeof ShareFileOutputSchema>;

export const ShareFileOutputJsonSchema = toToolJsonSchema(ShareFileOutputSchema);
