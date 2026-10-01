import {
  createBotShareFileForwarder,
  createLocalServices,
  createServiceLogger,
  type ZCodeAgentCommandResolver,
} from "@zcode/services/node";
import type { ChannelClient } from "@zcode/rpc";
import {
  parseServiceAuthorityMode,
  ZCODE_REMOTE_HTTP_PROXY_ENV_KEY,
  ZCODE_REMOTE_NO_PROXY_ENV_KEY,
  ZCODE_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY,
} from "@zcode/shared";

interface CreateStdioServicesOptions {
  env?: Record<string, string | undefined>;
  zcodeBuiltinProviderConfigFilePath: string;
  zcodeAgentCommandResolver?: ZCodeAgentCommandResolver;
  /**
   * Phase C Alpha 3：同一 stdio protocol 上的反向（远端→桌面）channel 客户端。
   * desktop-attached-remote 装配经它把 bots/shareFile 的裁决 forward 回桌面窗口
   * Host；缺省（无桌面 attached 的 stdio 形态）时保持本地裁决语义。
   */
  desktopChannelClient?: ChannelClient;
}

interface RemoteAgentNetworkOptions {
  httpProxy?: string;
  noProxy?: string;
}

function resolveRemoteAgentNetworkFromEnv(
  env: Record<string, string | undefined>,
): RemoteAgentNetworkOptions | undefined {
  if (env[ZCODE_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY]?.trim() !== "1") {
    return undefined;
  }
  return {
    httpProxy: env[ZCODE_REMOTE_HTTP_PROXY_ENV_KEY]?.trim() || undefined,
    noProxy: env[ZCODE_REMOTE_NO_PROXY_ENV_KEY]?.trim() || undefined,
  };
}

export function createStdioServices(options: CreateStdioServicesOptions) {
  const env = options.env ?? process.env;
  const authorityModeParseResult = parseServiceAuthorityMode(env);
  const remoteAgentNetwork = resolveRemoteAgentNetworkFromEnv(env);
  // Phase C Alpha 3：反向 forward 调用面（失败矩阵折叠在 createBotShareFileForwarder：
  // 旧桌面不回 Initialize → unsupported-method；传输错误/子超时 → send-failed）。
  // Alpha 4 诊断：注入 bots 域 service logger——Initialize 正向事实与每次 forward 结局
  // （reason + detail）经 stderr 汇入 "[remote]" 桌面日志，本模块自身不直接打日志。
  const desktopBotShareFileForward = options.desktopChannelClient
    ? createBotShareFileForwarder(options.desktopChannelClient, {
        logger: createServiceLogger("bots"),
      })
    : undefined;
  // 远程 Desktop 的呈现能力必须从 stdio 入口收到的 authority mode 进入 Services 推导链。
  // 测试注入 resolver 只用于在 spawn 前观察最终命令，不改变生产默认 resolver。
  const services = createLocalServices({
    zcodeBuiltinProviderConfigFilePath: options.zcodeBuiltinProviderConfigFilePath,
    serviceAuthorityMode: authorityModeParseResult.mode,
    zcodeAgentCommandResolver: options.zcodeAgentCommandResolver,
    remoteAgentNetwork,
    ...(desktopBotShareFileForward ? { desktopBotShareFileForward } : {}),
  });

  return {
    authorityModeParseResult,
    services,
  };
}
