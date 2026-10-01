import assert from "node:assert/strict";
import test from "node:test";
import type { ICredentialService } from "../src/credential/credential.js";
import type { ISettingService } from "../src/setting/setting.js";
import { createBotRemoteWorkspaceService } from "../src/bots/botRemoteWorkspaceBridge.js";

/**
 * 契约（specs/bot-file-delivery.md Phase C — Alpha 2，spec item 4）：
 *
 * `getWorkspaceFileReader` 与 `getZCodeTaskService` 共用 getRuntimeServices 缓存与
 * 失败约定：无连接信息/无 attachable route → null；runtime 初始化失败/超时 →
 * throw。调用方（botsService，后续工作包）据此映射 remote-unavailable。
 * 本文件只钉住这条 null/throw 约定；ok:true 路径需要真实 MessagePort 对，
 * 由 owner rig 手册链路覆盖（apps 无 CLI harness，services 侧无法廉价伪造
 * ChannelServer 端口对）。
 */

interface ParentPortLike {
  postMessage(message: unknown, transfer?: unknown[]): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  off?(event: "message", listener: (event: { data: unknown }) => void): void;
}

function buildServices(overrides?: { lastWorkspaceSession?: unknown[] }) {
  const settingService = {
    get: async () =>
      overrides?.lastWorkspaceSession
        ? { lastWorkspaceSession: overrides.lastWorkspaceSession }
        : {},
  } as unknown as ISettingService;
  const credentialService = {
    load: async () => null,
  } as unknown as ICredentialService;
  return { settingService, credentialService };
}

test("无 parentPort 时 bridge 整体缺席（getWorkspaceFileReader 不可用）", () => {
  const { settingService, credentialService } = buildServices();
  const bridge = createBotRemoteWorkspaceService({
    parentPort: null,
    settingService,
    credentialService,
  });
  assert.equal(bridge, undefined);
});

test("无匹配远程连接信息 → getWorkspaceFileReader 返回 null（不 throw）", async () => {
  const { settingService, credentialService } = buildServices();
  let posted = 0;
  const parentPort: ParentPortLike = {
    postMessage: () => {
      posted += 1;
    },
    on: () => {},
    off: () => {},
  };
  const bridge = createBotRemoteWorkspaceService({
    parentPort,
    settingService,
    credentialService,
  });
  assert.ok(bridge);
  const reader = await bridge.getWorkspaceFileReader({
    workspacePath: "/remote/ws",
    workspaceIdentity: "identity-1",
  });
  assert.equal(reader, null);
  // 未命中连接信息时不得向 main 请求 runtime port。
  assert.equal(posted, 0);
});

test("runtime port 初始化失败 → getWorkspaceFileReader 按约定 throw", async () => {
  const { settingService, credentialService } = buildServices({
    lastWorkspaceSession: [
      {
        kind: "remote",
        workspacePath: "/remote/ws",
        workspaceIdentity: "identity-1",
        target: { kind: "ssh", host: "h", port: 22, username: "u" },
      },
    ],
  });
  const parentPort: ParentPortLike = {
    postMessage: (message: unknown) => {
      const request = message as { type: string; requestId: string };
      if (request.type !== "bot-remote-workspace-runtime-port-request") return;
      queueMicrotask(() => {
        listener?.({
          data: {
            type: "bot-remote-workspace-runtime-port",
            requestId: request.requestId,
            ok: false,
            error: "remote offline",
          },
        });
      });
    },
    on: (_event, listener_) => {
      listener = listener_;
    },
    off: () => {},
  };
  let listener: ((event: { data: unknown }) => void) | undefined;
  const bridge = createBotRemoteWorkspaceService({
    parentPort,
    settingService,
    credentialService,
  });
  assert.ok(bridge);
  await assert.rejects(
    bridge.getWorkspaceFileReader({
      workspacePath: "/remote/ws",
      workspaceIdentity: "identity-1",
    }),
    /remote offline/,
  );
});
