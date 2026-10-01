import type { RemoteTarget } from "@zcode/shared";
import { isSameRemoteTarget } from "@zcode/shared";

/**
 * Phase C Alpha 3（specs/bot-file-delivery.md Phase C Alpha 3 §3）：bot-share-file-forward
 * 的钉扎作用域解析——本连接 target 上「在线」logical session 绑定的 workspace 集合。
 * 事实源是桌面连接注册表（session.target/state/sourceAvailability），绝非远端自报；
 * 被入侵的远端不能借本连接投递别的 workspace / 别的机器的会话；无在线 session 时
 * 作用域为空（fail-closed）。抽成纯函数是为了让该安全关键过滤可脱离 Electron
 * window host 单测覆盖（Review 修复）。
 */
export interface RemoteWorkspaceScopeFact {
  state: string;
  sourceAvailability: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  target: RemoteTarget;
}

export function resolveOnlineRemoteWorkspaceScopes(
  sessions: readonly RemoteWorkspaceScopeFact[],
  connectionTarget: RemoteTarget,
): Array<{ workspacePath: string; workspaceIdentity: string }> {
  return sessions
    .filter(
      (
        session,
      ): session is RemoteWorkspaceScopeFact & {
        workspacePath: string;
        workspaceIdentity: string;
      } =>
        session.state === "online" &&
        session.sourceAvailability === "online" &&
        session.workspacePath !== undefined &&
        session.workspaceIdentity !== undefined &&
        isSameRemoteTarget(session.target, connectionTarget),
    )
    .map((session) => ({
      workspacePath: session.workspacePath,
      workspaceIdentity: session.workspaceIdentity,
    }));
}
