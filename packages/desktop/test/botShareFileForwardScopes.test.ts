import assert from "node:assert/strict";
import test from "node:test";
import type { RemoteTarget } from "@zcode/shared";
// Phase C Alpha 3（Review 修复）：bot-share-file-forward 钉扎作用域的安全关键过滤
// 矩阵——脱离 Electron window host 直接驱动纯函数。
import { resolveOnlineRemoteWorkspaceScopes } from "../src/host/botShareFileForwardScopes.js";

const sshTarget: RemoteTarget = { kind: "ssh", host: "build-1", port: 22, username: "ci" };

function session(
  overrides: Partial<Parameters<typeof resolveOnlineRemoteWorkspaceScopes>[0][number]>,
) {
  return {
    state: "online",
    sourceAvailability: "online",
    workspacePath: "/remote/ws",
    workspaceIdentity: "identity-1",
    target: sshTarget,
    ...overrides,
  };
}

test("作用域矩阵：仅「在线 + 同 target + 带 identity」的 session 进入钉扎集合", () => {
  const scopes = resolveOnlineRemoteWorkspaceScopes(
    [
      session({}),
      session({ state: "offline" }),
      session({ sourceAvailability: "offline" }),
      session({ workspaceIdentity: undefined }),
      session({ workspacePath: undefined }),
      session({ target: { kind: "ssh", host: "other-host", port: 22, username: "ci" } }),
      session({ target: { kind: "ssh", host: "build-1", port: 2222, username: "ci" } }),
      session({ target: { kind: "ssh", host: "build-1", port: 22, username: "attacker" } }),
      session({ target: { kind: "wsl", distro: "d" } }),
    ],
    sshTarget,
  );
  assert.deepEqual(scopes, [{ workspacePath: "/remote/ws", workspaceIdentity: "identity-1" }]);
});

test("空注册表 / 无在线 session → 作用域为空（fail-closed）", () => {
  assert.deepEqual(resolveOnlineRemoteWorkspaceScopes([], sshTarget), []);
  assert.deepEqual(
    resolveOnlineRemoteWorkspaceScopes([session({ state: "connecting" })], sshTarget),
    [],
  );
});

test("同 target 多 workspace：全部进入作用域（一条连接可服务多个 workspace）", () => {
  const scopes = resolveOnlineRemoteWorkspaceScopes(
    [
      session({ workspacePath: "/remote/a", workspaceIdentity: "id-a" }),
      session({ workspacePath: "/remote/b", workspaceIdentity: "id-b" }),
    ],
    sshTarget,
  );
  assert.equal(scopes.length, 2);
  assert.deepEqual(
    new Set(scopes.map((scope) => `${scope.workspacePath}|${scope.workspaceIdentity}`)),
    new Set(["/remote/a|id-a", "/remote/b|id-b"]),
  );
});
