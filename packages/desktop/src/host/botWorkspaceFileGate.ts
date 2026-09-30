import { IBotWorkspaceFileService } from "@zcode/services";
import type { WindowHostAttachmentScope } from "@zcode/shared";
import type { V4BotWorkspaceFileReadResult } from "@zcode/shared/zcode-protocol-v4";
import { v4BotWorkspaceFileReadParamsSchema } from "@zcode/shared/zcode-protocol-v4";

/**
 * Bot-only 锁（Phase C Alpha 2，specs/bot-file-delivery.md Phase C §3）：
 * bot-workspace-file channel 不进任何 ServiceCollection——renderer/relay/phone
 * attachment 的 exposeOnChannelServer 结构上注册不到它；只有 main 以
 * attachmentKind="bot-runtime" 标记的远端 attachment 才能拿到这里构造的窄化
 * 单方法服务。独立成纯函数是为了让安全关键路径（gate 判定 + scope 注入 +
 * wire 校验折叠）可以脱离 Electron MessagePort 被单测覆盖（Review 修复）。
 */
export function createScopedBotWorkspaceFileService(options: {
  attachmentKind?: "bot-runtime";
  attachmentScope: WindowHostAttachmentScope;
  factory?: () => IBotWorkspaceFileService;
}): IBotWorkspaceFileService | undefined {
  if (options.attachmentKind !== "bot-runtime" || options.attachmentScope.kind !== "remote") {
    return undefined;
  }
  const base = options.factory?.();
  if (!base) {
    return undefined;
  }
  const remoteScope = options.attachmentScope;
  return {
    readWorkspaceFile: async (params): Promise<V4BotWorkspaceFileReadResult> => {
      try {
        // Review 修复（BLOCKER）：service 层参数还携带 workspacePath/workspaceIdentity
        // （strict v4 schema 会把多余键判为 unrecognized_keys 而永远拒绝），
        // 因此这里只挑 wire 三字段校验；workspace 字段以本 attachment 的 scope
        // 真值为准，调用方自报值一律忽略。
        const wireParams = v4BotWorkspaceFileReadParamsSchema.parse({
          relativePath: params.relativePath,
          offset: params.offset,
          limit: params.limit,
        });
        return await base.readWorkspaceFile({
          relativePath: wireParams.relativePath,
          offset: wireParams.offset,
          limit: wireParams.limit,
          workspacePath: remoteScope.workspacePath,
          workspaceIdentity: remoteScope.workspaceIdentity,
        });
      } catch (error) {
        // 旧远端 zcode-server 未注册该 channel / SSH 中断 / 入参不合 wire 契约：
        // 折叠为结构化 unavailable，调用方映射 remote-unavailable，不依赖错误文本。
        return {
          ok: false,
          reason: "unavailable" as const,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
