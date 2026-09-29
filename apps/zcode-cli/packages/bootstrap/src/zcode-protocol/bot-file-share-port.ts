// ============================================================
// Bot File Share Port - bots/shareFile host RPC boundary
// ============================================================
// 照抄 automation-port 的结构：按 session 构造、直接绑定自己所服务的 session record
// （不依赖 context.sessions 查找），经 requestClient 发反向 Host 请求。差异点：
//   - 收件人永不进入协议参数——Host 从 taskDeliveryRegistry 按 taskId 解析；
//     本地只做 fail-closed 的「本轮有没有 Bot 回推地址」判断。
//   - 结局是结构化 BotShareFileResult：-32601（旧 Host）→ unsupported-method；
//     超时 → unknown-outcome（不能断言成败）；其余传输错误 → send-failed。

import { type BotFileSharePort } from "@zcode/contracts";
import { zcodeBotsShareFileResultSchema, zcodeProtocolMethods } from "@zcode/shared";
import {
  ProtocolRequestError,
  type ZCodeProtocolAgentServerContext,
  type ZCodeProtocolSessionRecord,
} from "./server-types.js";

// RPC 超时必须明显高于 Host 侧 provider 上传+发送预算（契约 "timeout > provider margin"）：
// getuploadurl 15s + CDN 上传 60s×3 次重试 + sendmessage（含 ret=-2 去_token 重试）15s×2，
// 最坏 ≈225s。取 300s 留出余量，保证只有真正失去应答才判超时，映射为 unknown-outcome，
// 绝不把仍在投递中的请求误判成假成功/假失败。
const BOT_SHARE_FILE_RPC_TIMEOUT_MS = 300_000;

export function createProtocolBotFileSharePort(
  context: ZCodeProtocolAgentServerContext,
  // 归属会话解析器：与 automation-port 同款，直接绑定本端口所服务的 session record，
  // 避免 V4/desktop 会话不在 legacy map 里导致的 activeSession 命中失败。
  resolveOwnSession?: () => ZCodeProtocolSessionRecord | undefined,
): BotFileSharePort {
  return {
    async share(path) {
      const activeSession = resolveOwnSession?.();
      // fail-closed：本轮没有 Bot 回推地址（非 bot turn、排队输入跨轮、目标已被还原）
      // 就不发起 RPC——Host 侧 registry 也不会有可解析的收件人。
      if (!activeSession?.activeBotDeliveryTarget) {
        return { ok: false, reason: "no-target" };
      }
      try {
        // taskId = 本会话 id（协议里 task 即 session；adapter 侧以 sessionId 投影 taskId）。
        return await context.requestClient(
          zcodeProtocolMethods.botsShareFile,
          { taskId: activeSession.app.sessionId, path },
          zcodeBotsShareFileResultSchema,
          { timeoutMs: BOT_SHARE_FILE_RPC_TIMEOUT_MS },
        );
      } catch (error) {
        if (error instanceof ProtocolRequestError && error.code === -32601) {
          // 旧 Host 不认识 bots/shareFile；能力差异映射为结构化失败，不升级为异常。
          return { ok: false, reason: "unsupported-method" };
        }
        if (error instanceof ProtocolRequestError && error.code === -32022) {
          // 超时：Host 可能已经/正在投递，结局未知；显式告知模型让用户在聊天里确认。
          return { ok: false, reason: "unknown-outcome" };
        }
        return {
          ok: false,
          reason: "send-failed",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
