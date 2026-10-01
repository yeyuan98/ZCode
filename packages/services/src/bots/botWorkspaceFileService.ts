import { ServiceChannels } from "@zcode/shared";
import type { V4BotWorkspaceFileReadResult } from "@zcode/shared/zcode-protocol-v4";
import { createServiceDescriptor } from "../descriptors.js";

/**
 * IBotWorkspaceFileService —— Bot 出站投递（Phase C Alpha 2）专用的远端 workspace
 * 文件读取窄化 channel：单方法、分块、带硬上限（详见 specs/bot-file-delivery.md）。
 *
 * 暴露边界（结构性保证，非角色启发）：
 *  - 远端 zcode-server（desktop-attached-remote 装配）注册本 channel，只对持有
 *    SSH/Docker 连接的 desktop window Host 可见（可信跳）；
 *  - window Host 只在 `attachmentKind === "bot-runtime"` 的 attachment 端口上注册
 *    本 channel，且转发时注入该 attachment scope 的 workspacePath/workspaceIdentity
 *    （调用方自报的 workspace 字段被忽略）——renderer/relay/phone attachment 结构上
 *    无法触达；
 *  - `IZCodeAgentService` 不增方法（已记录决议：replay 客户端共享该接口）。
 */
export interface IBotWorkspaceFileService {
  /**
   * 读取远端 workspace 文件的一个分块（≤512KiB）。结果即 v4 wire result：
   * `{ok:true; filename; sizeBytes; dataBase64; eof}` 或
   * `{ok:false; reason: outside-workspace|not-found|too-large|unavailable}`。
   * 路径 containment 完全由远端 CLI 裁决；transport/路由层失败统一为
   * `unavailable`（含旧远端 CLI 不认识 v4 方法），调用方映射为 remote-unavailable。
   */
  readWorkspaceFile(params: {
    workspacePath: string;
    workspaceIdentity: string;
    relativePath: string;
    offset: number;
    limit: number;
  }): Promise<V4BotWorkspaceFileReadResult>;
}

export const IBotWorkspaceFileService = createServiceDescriptor<IBotWorkspaceFileService>(
  ServiceChannels.BotWorkspaceFile,
);

/** 远端 server 侧实现依赖的 v4 转发面（zcodeAgentService 的非接口窄化成员）。 */
export interface BotWorkspaceFileV4Forwarder {
  readV4(params: {
    workspacePath: string;
    workspaceIdentity?: string;
    relativePath: string;
    offset: number;
    limit: number;
  }): Promise<V4BotWorkspaceFileReadResult>;
}

/**
 * 把 v4 转发面包装成 IBotWorkspaceFileService（远端 zcode-server 装配使用）。
 * 这里不做额外策略：路径 containment 由远端 CLI 网关裁决，本层只透传与
 * 保持单一 v4 client 归属（无并行队列）。
 */
export function createBotWorkspaceFileService(
  forwarder: BotWorkspaceFileV4Forwarder,
): IBotWorkspaceFileService {
  return {
    async readWorkspaceFile(params) {
      return forwarder.readV4(params);
    },
  };
}
