import assert from "node:assert/strict";
import test from "node:test";
import type { IBotWorkspaceFileService } from "@zcode/services";
import type { WindowHostAttachmentScope } from "@zcode/shared";
// Phase C Alpha 2（Review 修复）：Bot-only 锁的安全关键路径单测——gate 判定 +
// scope 注入 + wire 三字段校验折叠，独立于 Electron MessagePort 直接驱动纯函数。
import { createScopedBotWorkspaceFileService } from "../src/host/botWorkspaceFileGate.js";

const remoteScope: Extract<WindowHostAttachmentScope, { kind: "remote" }> = {
  kind: "remote",
  remoteSessionId: "rs-1",
  workspacePath: "/remote/ws",
  workspaceIdentity: "identity-1",
};

function createCapturingBase(
  captures: Array<{ params: Record<string, unknown> }>,
  impl?: IBotWorkspaceFileService["readWorkspaceFile"],
): () => IBotWorkspaceFileService {
  return () => ({
    readWorkspaceFile: async (params) => {
      captures.push({ params: { ...params } });
      if (impl) {
        return impl(params);
      }
      return {
        ok: true,
        filename: "a.png",
        sizeBytes: 3,
        dataBase64: Buffer.from("abc").toString("base64"),
        eof: true,
      };
    },
  });
}

test("gate：非 bot-runtime attachment 一律拿不到 channel（renderer/relay/phone）", () => {
  const factory = createCapturingBase([]);
  assert.equal(
    createScopedBotWorkspaceFileService({ attachmentScope: remoteScope, factory }),
    undefined,
  );
  assert.equal(
    createScopedBotWorkspaceFileService({
      attachmentKind: "bot-runtime",
      attachmentScope: { kind: "local" },
      factory,
    }),
    undefined,
  );
  assert.equal(
    createScopedBotWorkspaceFileService({
      attachmentKind: "bot-runtime",
      attachmentScope: remoteScope,
    }),
    undefined,
  );
});

test("gate：bot-runtime + remote scope + factory → 注入 scope 真值并忽略调用方自报 workspace 字段", async () => {
  const captures: Array<{ params: Record<string, unknown> }> = [];
  const service = createScopedBotWorkspaceFileService({
    attachmentKind: "bot-runtime",
    attachmentScope: remoteScope,
    factory: createCapturingBase(captures),
  });
  assert.ok(service);
  const result = await service.readWorkspaceFile({
    // Review 修复回归钉：service 层参数携带 workspacePath/workspaceIdentity（多余键），
    // 包装必须只挑 wire 三字段校验并透传成功——strict schema 不再误拒（曾致全链路失败）。
    workspacePath: "/spoofed/local/path",
    workspaceIdentity: "spoofed-identity",
    relativePath: "report.png",
    offset: 0,
    limit: 512 * 1024,
  } as Parameters<IBotWorkspaceFileService["readWorkspaceFile"]>[0]);
  assert.equal(result.ok, true);
  assert.equal(captures.length, 1);
  assert.equal(captures[0].params.workspacePath, "/remote/ws");
  assert.equal(captures[0].params.workspaceIdentity, "identity-1");
  assert.equal(captures[0].params.relativePath, "report.png");
});

test("包装：底层抛错（旧远端 server 无 channel / SSH 中断）→ 折叠为结构化 unavailable", async () => {
  const service = createScopedBotWorkspaceFileService({
    attachmentKind: "bot-runtime",
    attachmentScope: remoteScope,
    factory: createCapturingBase([], async () => {
      throw new Error("channel missing on old remote server");
    }),
  });
  assert.ok(service);
  const result = await service.readWorkspaceFile({
    relativePath: "x.txt",
    offset: 0,
    limit: 1024,
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "unavailable",
    detail: "channel missing on old remote server",
  });
});

test("包装：不合 wire 契约的入参（limit=0）→ fail-closed unavailable，不透传到底层", async () => {
  const captures: Array<{ params: Record<string, unknown> }> = [];
  const service = createScopedBotWorkspaceFileService({
    attachmentKind: "bot-runtime",
    attachmentScope: remoteScope,
    factory: createCapturingBase(captures),
  });
  assert.ok(service);
  const result = await service.readWorkspaceFile({
    relativePath: "x.txt",
    offset: 0,
    limit: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "unavailable");
  assert.equal(captures.length, 0);
});
