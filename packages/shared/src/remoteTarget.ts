import type { RemoteAssetInstallMode } from "./remoteAssetInstallMode.js";
import type { RemoteResourcePackageSelection } from "./remoteResourcePackages.js";

export interface SSHConnectOptions {
  kind: "ssh";
  host: string;
  port?: number;
  username: string;
  sshConfigAlias?: string;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  assetInstallMode?: RemoteAssetInstallMode;
  resourcePackages?: RemoteResourcePackageSelection;
}

export interface WSLConnectOptions {
  kind: "wsl";
  distro?: string;
  user?: string;
}

export interface DockerConnectOptions {
  kind: "docker";
  container: string;
}

export type RemoteTarget = SSHConnectOptions | WSLConnectOptions | DockerConnectOptions;

/** 删除只应存在于当前连接流程中的 secret，供长期内存状态和跨进程回包使用。 */
export function stripRemoteTargetSecrets(target: RemoteTarget): RemoteTarget {
  if (target.kind === "ssh") {
    const {
      password: _password,
      privateKeyPassphrase: _privateKeyPassphrase,
      ...sanitized
    } = target;
    return sanitized;
  }

  return target;
}

/**
 * 判定两个 RemoteTarget 是否指向同一台远端机器（secret 字段不参与比较）。
 * Phase C Alpha 3 引入：desktop window Host 用它在连接注册表里筛出「本连接 target
 * 上的 logical session」，作为跨 Host share_file forward 的 workspace 钉扎作用域；
 * 与 desktop main 的同名私有比较器语义保持一致（main 版额外覆盖 server 快照形态）。
 */
export function isSameRemoteTarget(left: RemoteTarget, right: RemoteTarget): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "ssh":
      return (
        right.kind === "ssh" &&
        left.host.trim().toLowerCase() === right.host.trim().toLowerCase() &&
        (left.port ?? 22) === (right.port ?? 22) &&
        left.username.trim() === right.username.trim() &&
        (left.privateKeyPath ?? "") === (right.privateKeyPath ?? "")
      );
    case "wsl":
      return (
        right.kind === "wsl" &&
        (left.distro?.trim() || "default") === (right.distro?.trim() || "default") &&
        (left.user?.trim() ?? "") === (right.user?.trim() ?? "")
      );
    case "docker":
      return right.kind === "docker" && left.container === right.container;
  }
}
