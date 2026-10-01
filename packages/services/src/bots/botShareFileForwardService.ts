import {
  ServiceChannels,
  zcodeBotsShareFileParamsSchema,
  zcodeBotsShareFileResultSchema,
  type BotShareFileResult,
} from "@zcode/shared";
import { ChannelClient, ProxyChannel } from "@zcode/rpc";
import { createServiceDescriptor } from "../descriptors.js";
import type { ServiceLogger } from "../logger/serviceLogger.js";
import type { IBotsService } from "./bots.js";

/**
 * IBotShareFileForwardService —— 对话式 share_file 的远端→桌面反向转发窄化 channel
 * （Phase C Alpha 3，specs/bot-file-delivery.md）。
 *
 * 背景（本 alpha 修复的生产 bug）：远端 zcode-server（desktop-attached-remote 装配）
 * 自己的 taskDeliveryRegistry 恒为空（bot 入站只落在桌面窗口 Host），其本地自答的
 * shareFileForTask 必然 no-target。修复方向：远端装配绝不本地解析收件人，而是把
 * {taskId, path} 经本 channel 转发给桌面窗口 Host 的单一写出核心裁决。
 *
 * 暴露边界（结构性保证，与 IBotWorkspaceFileService 同款纪律）：
 *  - 桌面侧：window Host 在与远端 zcode-server 的 stdio 连接 protocol 上以独立
 *    ChannelServer 注册本 channel（RequestType/ResponseType 数值域不相交，两个方向
 *    共享同一条 stdio 流），实现钉扎到本连接的 workspace 作用域；
 *  - 参数复用严格 zcodeBotsShareFileParamsSchema：未知键拒绝，且绝不出现任何
 *    recipient/provider/peer/workspace 字段——workspace 由桌面从连接作用域推导，
 *    从不信调用方自报；
 *  - standalone-server / desktop-local 装配不注册、不调用本 channel，语义不变。
 */
export interface IBotShareFileForwardService {
  /**
   * 转发一次对话式 share_file 裁决。结果即 BotShareFileResult（与协议 RPC 同一
   * 判别联合）；transport/路由层失败按 PromiseError 传回，由远端 forwarder 统一
   * 折叠为 send-failed。
   */
  forward(params: { taskId: string; path: string }): Promise<BotShareFileResult>;
}

export const IBotShareFileForwardService = createServiceDescriptor<IBotShareFileForwardService>(
  ServiceChannels.BotShareFileForward,
);

/** 远端装配持有的 forward 调用面（单函数，便于 node 装配与单测注入）。 */
export type BotShareFileForwarder = (params: {
  taskId: string;
  path: string;
}) => Promise<BotShareFileResult>;

/**
 * forward 子超时：必须落在 CLI 端口 300s RPC 预算之内（bot-file-share-port.ts），让
 * CLI 收到确定的 send-failed 而不是 unknown-outcome。注意：桌面侧投递可能在超时后
 * 仍完成（CLI 散文如实说明请求失败，不断言投递结局）。
 */
const BOT_SHARE_FILE_FORWARD_TIMEOUT_MS = 280_000;

/**
 * 桌面侧 forward handler 工厂（window Host 装配使用；纯函数，可脱离 Electron 单测）。
 * 钉扎作用域 resolveWorkspaceScopes 必须返回「本连接 target 上的在线 logical session
 * 所绑定的 workspace 集合」——那是连接注册表的桌面事实；返回空集即 fail-closed。
 */
export function createDesktopBotShareFileForwardService(options: {
  botsService: Pick<IBotsService, "shareFileForTask">;
  resolveWorkspaceScopes: () => Array<{ workspacePath: string; workspaceIdentity?: string }>;
}): IBotShareFileForwardService {
  return {
    async forward(rawParams) {
      // 入口再做一次严格 schema 校验：channel 上没有 zcodeAgentService 的前置把关，
      // 任何越界键（包括伪造的 recipient/workspace 字段）必须在此拒绝并以结构化
      // 错误回传（远端折叠为 send-failed），绝不静默吞掉。
      const parsed = zcodeBotsShareFileParamsSchema.safeParse(rawParams);
      if (!parsed.success) {
        throw new Error("Invalid bots shareFile forward params");
      }
      return options.botsService.shareFileForTask(parsed.data, {
        restrictToWorkspaces: options.resolveWorkspaceScopes(),
      });
    },
  };
}

/** forward 子超时的判别错误：与普通传输错误区分，detail 文案不同。 */
class BotShareFileForwardTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`bot share file forward timed out after ${timeoutMs}ms`);
    this.name = "BotShareFileForwardTimeoutError";
  }
}

/**
 * 就绪门折叠的稳定 detail 签名：生产排障时它是「桌面反向 channel 从未初始化」
 * （Chain Y）的唯一 chat 侧可 grep 证据，与远端 -32601 "unavailable on this host"
 * （Chain X-a）区分。措辞必须保持逐字稳定。
 */
const DESKTOP_REVERSE_CHANNEL_NEVER_INITIALIZED_DETAIL =
  "desktop reverse channel never initialized";

/**
 * 远端装配的 forwarder 工厂：把远端→桌面的 channel 调用折叠为 BotShareFileResult
 * 失败矩阵（specs Phase C Alpha 3 §4）：
 *  - 桌面从未回 Initialize（旧桌面不构造 desktop-serving ChannelServer）→ 立即
 *    unsupported-method，绝不排队（排队会挂满整个 CLI 预算）；
 *  - 传输错误 / 桌面 handler 抛错 / 桌面回包不合法 → send-failed（带 detail）；
 *  - 280s 子超时 → send-failed（CLI 300s 预算内拿到确定答案）。
 *
 * logger（可选注入，Alpha 4 诊断）：一次性正向日志（Initialize 收到）+ 每次 forward
 * 的结局日志（reason + detail，绝不记文件路径——用户数据）。
 */
export function createBotShareFileForwarder(
  client: ChannelClient,
  options?: { timeoutMs?: number; logger?: Pick<ServiceLogger, "info"> },
): BotShareFileForwarder {
  const timeoutMs = options?.timeoutMs ?? BOT_SHARE_FILE_FORWARD_TIMEOUT_MS;
  const logger = options?.logger;
  // Review 修复（Initialize 竞态）：就绪判定改为调用时轮询 isInitialized() 状态，而不是
  // 构造期订阅 onDidInitialize——Initialize 只发一次且 Emitter 无重放，若工厂在 Initialize
  // 已送达后才构造（entry-stdio 的 materialize await 之后），事件订阅会永久漏掉，新桌面
  // 被误判为 unsupported-method。状态式查询对构造时机免疫；事件订阅保留作冗余兜底。
  // 正向事实必须自宣（Alpha 4 诊断）：反向链路健康时此前零日志，排障只能靠反证。
  let loggedInitialized = false;
  const logInitializedOnce = () => {
    if (loggedInitialized) return;
    loggedInitialized = true;
    logger?.info(undefined, "bot share file forward channel initialized");
  };
  let desktopChannelsReady = client.isInitialized();
  if (desktopChannelsReady) {
    // Initialize 已在构造前送达（低 RTT 竞态赢家）：one-shot 正向日志不能跟着事件丢失。
    logInitializedOnce();
  }
  client.onDidInitialize(() => {
    desktopChannelsReady = true;
    logInitializedOnce();
  });
  return async (params) => {
    if (!desktopChannelsReady && !client.isInitialized()) {
      logger?.info(
        undefined,
        "bot share file forward folded: unsupported-method",
        DESKTOP_REVERSE_CHANNEL_NEVER_INITIALIZED_DETAIL,
      );
      return {
        ok: false,
        reason: "unsupported-method",
        detail: DESKTOP_REVERSE_CHANNEL_NEVER_INITIALIZED_DETAIL,
      };
    }
    const service = ProxyChannel.toService<IBotShareFileForwardService>(
      client.getChannel(IBotShareFileForwardService.channelName),
    );
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new BotShareFileForwardTimeoutError(timeoutMs)), timeoutMs);
      });
      // 超时分支在竞速落败后仍会 reject：挂一个 no-op catch 避免 unhandledRejection。
      timeout.catch(() => undefined);
      let result: BotShareFileResult;
      try {
        result = await Promise.race([service.forward(params), timeout]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      const parsed = zcodeBotsShareFileResultSchema.safeParse(result);
      if (!parsed.success) {
        logger?.info(
          undefined,
          "bot share file forward folded: send-failed",
          "desktop forward returned an invalid shareFile result",
        );
        return {
          ok: false,
          reason: "send-failed",
          detail: "desktop forward returned an invalid shareFile result",
        };
      }
      // 结局日志只含 reason/detail（ok 或失败矩阵），不落文件路径（用户数据）。
      logger?.info(
        undefined,
        parsed.data.ok
          ? "bot share file forward outcome: ok"
          : `bot share file forward outcome: ${parsed.data.reason}${parsed.data.detail ? ` (${parsed.data.detail})` : ""}`,
      );
      return parsed.data;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger?.info(undefined, "bot share file forward folded: send-failed", detail);
      return { ok: false, reason: "send-failed", detail };
    }
  };
}

/**
 * botsShareFileExecutor 的装配裁决（node 装配与单测共用同一实现）：
 *  - 注入了 forwarder（仅 desktop-attached-remote 且 stdio 入口提供了桌面 channel
 *    客户端）→ 一律 forward，绝不本地自答（本地注册表恒空，自答必 no-target）；
 *  - 其余装配（desktop-local / standalone-server / 未注入 forward）→ 保持今日本地
 *    单写者裁决语义：装配完成前到达的请求按 no-target 拒绝（fail-closed，与 CLI 端
 *    unsupported-method 语义衔接）。
 */
export function createBotsShareFileExecutor(options: {
  forwarder?: BotShareFileForwarder;
  resolveLocalBotsService: () => Pick<IBotsService, "shareFileForTask"> | undefined;
}): (params: { taskId: string; path: string }) => Promise<BotShareFileResult> {
  const forwarder = options.forwarder;
  if (forwarder) {
    return (params) => forwarder(params);
  }
  return (params) => {
    const localBotsService = options.resolveLocalBotsService();
    return localBotsService
      ? localBotsService.shareFileForTask(params)
      : Promise.resolve({ ok: false, reason: "no-target" } satisfies BotShareFileResult);
  };
}
