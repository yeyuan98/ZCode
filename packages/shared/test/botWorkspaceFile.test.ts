import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  BOT_WORKSPACE_FILE_HARD_CAP_BYTES,
  botWorkspaceFileSizeExceedsHardCap,
  classifyBotWorkspaceFileFsError,
  evaluateBotWorkspaceFilePath,
  isRealpathInsideWorkspace,
} from "../src/botWorkspaceFilePolicy.ts";
import { PROTOCOL_V4_LIMITS } from "../src/zcode-protocol-v4/core.ts";
import {
  v4BotWorkspaceFileReadFailureReasonSchema,
  v4BotWorkspaceFileReadParamsSchema,
  v4BotWorkspaceFileReadResultSchema,
} from "../src/zcode-protocol-v4/transport.ts";
import type { V4BotWorkspaceFileReadFailureReason } from "../src/zcode-protocol-v4/transport.ts";
import { hostAttachServicePortMessageSchema } from "../src/validation.ts";

/**
 * 契约（specs/bot-file-delivery.md Phase C — Alpha 2，验收场景 6）：
 *
 * 1. `v4/bot-workspace-file/read` 的 params/result 是 strict zod——未知键拒绝、
 *    limit 落在 1..524288、result ok 分块的 base64 解码 ≤512KiB。
 *    绝对 relativePath 不被 schema 拒绝：containment 裁决（放行或 outside-workspace
 *    结果）归远端 CLI（文件系统所有者），不是协议错误。
 * 2. 纯路径策略矩阵：相对/绝对-inside 平价（同文件）、绝对-outside / 词法 `..` 逃逸 /
 *    realpath 逃逸 / 跨 OS 语义。
 * 3. AttachServicePort 的 attachmentKind 是 additive 的 bot-only 标记。
 */

const CHUNK_MAX = PROTOCOL_V4_LIMITS.attachmentChunkMaxBytes;
assert.equal(CHUNK_MAX, 524_288);

test("params schema 接受合法相对路径与 chunk 边界值", () => {
  const valid = v4BotWorkspaceFileReadParamsSchema.safeParse({
    relativePath: "reports/result.png",
    offset: 0,
    limit: CHUNK_MAX,
  });
  assert.equal(valid.success, true);
  assert.deepEqual(valid.success && valid.data, {
    relativePath: "reports/result.png",
    offset: 0,
    limit: CHUNK_MAX,
  });

  // limit 下界 1 也合法（空块探测）；offset 允许 0。
  assert.equal(
    v4BotWorkspaceFileReadParamsSchema.safeParse({ relativePath: "a", offset: 0, limit: 1 })
      .success,
    true,
  );
});

test("params schema 拒绝未知键与越界数值", () => {
  const payloads = [
    { relativePath: "a.txt", offset: 0, limit: 0 },
    { relativePath: "a.txt", offset: 0, limit: CHUNK_MAX + 1 },
    { relativePath: "a.txt", offset: -1, limit: 1 },
    { relativePath: "a.txt", offset: 1.5, limit: 1 },
    { relativePath: "a.txt", offset: 0, limit: 1, sessionId: "s" },
    { relativePath: "a.txt", offset: 0, limit: 1, workspacePath: "/ws" },
    { relativePath: "", offset: 0, limit: 1 },
    { relativePath: "   ", offset: 0, limit: 1 },
    { offset: 0, limit: 1 },
  ];
  for (const payload of payloads) {
    const parsed = v4BotWorkspaceFileReadParamsSchema.safeParse(payload);
    assert.equal(parsed.success, false, `应拒绝：${JSON.stringify(payload)}`);
  }
});

test("params schema trim relativePath 但不拒绝绝对路径（结果语义归远端）", () => {
  const trimmed = v4BotWorkspaceFileReadParamsSchema.safeParse({
    relativePath: "  a.txt  ",
    offset: 0,
    limit: 1,
  });
  assert.equal(trimmed.success, true);
  assert.equal(trimmed.success && trimmed.data.relativePath, "a.txt");

  // 绝对路径必须能通过 schema：containment 裁决（放行或拒绝）的职责在远端 CLI。
  assert.equal(
    v4BotWorkspaceFileReadParamsSchema.safeParse({
      relativePath: "/etc/passwd",
      offset: 0,
      limit: 1,
    }).success,
    true,
  );
});

test("result schema：ok 分支往返并限制分块解码字节", () => {
  const okPayload = {
    ok: true,
    filename: "result.png",
    sizeBytes: 1234,
    dataBase64: Buffer.from("hello").toString("base64"),
    eof: true,
  };
  const parsed = v4BotWorkspaceFileReadResultSchema.safeParse(okPayload);
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.success && parsed.data, okPayload);

  // 空块 + eof（offset 越过 EOF 的幂等终止）合法。
  assert.equal(
    v4BotWorkspaceFileReadResultSchema.safeParse({
      ok: true,
      filename: "a",
      sizeBytes: 10,
      dataBase64: "",
      eof: true,
    }).success,
    true,
  );

  // 超过 512KiB 解码字节的分块必须被拒绝（wire 层纵深防御）。
  const oversized = Buffer.alloc(CHUNK_MAX + 1).toString("base64");
  assert.equal(
    v4BotWorkspaceFileReadResultSchema.safeParse({
      ok: true,
      filename: "a",
      sizeBytes: CHUNK_MAX + 1,
      dataBase64: oversized,
      eof: true,
    }).success,
    false,
  );

  // 非法 base64 拒绝。
  assert.equal(
    v4BotWorkspaceFileReadResultSchema.safeParse({
      ok: true,
      filename: "a",
      sizeBytes: 1,
      dataBase64: "not-base64!!",
      eof: true,
    }).success,
    false,
  );

  // 未知键拒绝。
  assert.equal(
    v4BotWorkspaceFileReadResultSchema.safeParse({
      ok: true,
      filename: "a",
      sizeBytes: 1,
      dataBase64: "",
      eof: true,
      mediaType: "image/png",
    }).success,
    false,
  );
});

test("result schema：四个 failure reason 原样往返且拒绝未知键", () => {
  assert.deepEqual(v4BotWorkspaceFileReadFailureReasonSchema.options, [
    "outside-workspace",
    "not-found",
    "too-large",
    "unavailable",
  ]);
  for (const reason of v4BotWorkspaceFileReadFailureReasonSchema.options as readonly V4BotWorkspaceFileReadFailureReason[]) {
    const withDetail = v4BotWorkspaceFileReadResultSchema.safeParse({
      ok: false,
      reason,
      detail: `detail for ${reason}`,
    });
    assert.equal(withDetail.success, true, `reason=${reason} 应通过`);
    const bare = v4BotWorkspaceFileReadResultSchema.safeParse({ ok: false, reason });
    assert.equal(bare.success, true, `裸 reason=${reason} 应通过`);
  }
  assert.equal(
    v4BotWorkspaceFileReadResultSchema.safeParse({ ok: false, reason: "quota-exceeded" }).success,
    false,
  );
  assert.equal(
    v4BotWorkspaceFileReadResultSchema.safeParse({
      ok: false,
      reason: "not-found",
      extra: 1,
    }).success,
    false,
  );
});

test("路径策略矩阵（POSIX 远端）：绝对路径按 containment 裁决，root 内与相对形式同文件", () => {
  const cases: Array<{ input: string; expected: "outside-workspace" | "ok" }> = [
    // 绝对-outside / 绝对形式的 `..` 逃逸 / 前缀相同但非分隔符边界 → 拒绝。
    { input: "/etc/passwd", expected: "outside-workspace" },
    { input: "/ws/../outside.txt", expected: "outside-workspace" },
    { input: "/ws-outside/file", expected: "outside-workspace" },
    // 绝对-inside：Alpha 3 起与本地 resolver 平价——放行（realpath 层仍兜底）。
    { input: "/ws/reports/result.png", expected: "ok" },
    { input: "/ws/sub/../file.txt", expected: "ok" },
    { input: "../outside.txt", expected: "outside-workspace" },
    { input: "sub/../../outside.txt", expected: "outside-workspace" },
    { input: "..", expected: "outside-workspace" },
    { input: "a/b/c/../../../../z", expected: "outside-workspace" },
    { input: "reports/result.png", expected: "ok" },
    { input: "sub/../file.txt", expected: "ok" },
    { input: "./file.txt", expected: "ok" },
    // POSIX 远端把反斜杠当普通文件名字符：词法上不逃逸（真实 containment 由
    // realpath 层兜底；不存在即 not-found），这是「远端 OS 语义」的刻意行为。
    { input: "sub\\..\\..\\etc", expected: "ok" },
    // Windows 盘符绝对路径在 POSIX 远端 isAbsolute=false：整串是普通文件名，词法上
    // 不逃逸（join 成 /ws/C:\ws\file.txt，fs 层归 not-found）——跨 OS 语义保持一致。
    { input: "C:\\ws\\file.txt", expected: "ok" },
  ];
  for (const { input, expected } of cases) {
    const decision = evaluateBotWorkspaceFilePath({
      pathOps: path.posix,
      workspaceRoot: "/ws",
      relativePath: input,
    });
    assert.equal(
      decision.ok,
      expected === "ok",
      `relativePath=${input} 期望 ${expected}，实际 ${JSON.stringify(decision)}`,
    );
    if (expected === "ok" && decision.ok) {
      assert.equal(
        decision.lexicalPath === "/ws" || decision.lexicalPath.startsWith("/ws/"),
        true,
        `词法路径必须仍在 root 内：${decision.lexicalPath}`,
      );
    }
  }
  // 平价断言：同一文件写成绝对或相对形式，词法解析结果必须完全一致
  // （绝对输入是 normalize 原样，不是 join(root, absolute) 的错误拼接）。
  const absoluteForm = evaluateBotWorkspaceFilePath({
    pathOps: path.posix,
    workspaceRoot: "/ws",
    relativePath: "/ws/reports/result.png",
  });
  const relativeForm = evaluateBotWorkspaceFilePath({
    pathOps: path.posix,
    workspaceRoot: "/ws",
    relativePath: "reports/result.png",
  });
  assert.ok(absoluteForm.ok && relativeForm.ok);
  assert.equal(absoluteForm.lexicalPath, "/ws/reports/result.png");
  assert.equal(absoluteForm.lexicalPath, relativeForm.lexicalPath);
});

test("路径策略矩阵（Windows 远端）：盘符/UNC 按 containment 裁决，root 内绝对路径放行", () => {
  const cases: Array<{ input: string; expected: "outside-workspace" | "ok" }> = [
    { input: "C:\\Windows\\system32", expected: "outside-workspace" },
    { input: "\\\\server\\share\\x", expected: "outside-workspace" },
    // 绝对-inside（含绝对形式 `..` 归一后仍在 root 内）→ 放行。
    { input: "C:\\ws\\reports\\result.png", expected: "ok" },
    { input: "C:\\ws\\sub\\..\\file.txt", expected: "ok" },
    // 绝对形式 `..` 逃逸：normalize 成 C:\\outside.txt 后落在 root 外 → 拒绝。
    { input: "C:\\ws\\..\\outside.txt", expected: "outside-workspace" },
    // POSIX 风格绝对路径在 win32 语义下是驱动器相对（\\ws\\file.txt），不在 C:\\ws 内
    // → 拒绝；跨 OS 语义由注入的 pathOps 决定，不做字符串启发。
    { input: "/ws/file.txt", expected: "outside-workspace" },
    { input: "..\\outside.txt", expected: "outside-workspace" },
    { input: "sub\\..\\file.txt", expected: "ok" },
    { input: "reports\\result.png", expected: "ok" },
    // drive-relative（C:file.txt）经 join+normalize 被当作字面子路径
    // （C:\ws\C:file.txt）——词法 containment 仍成立（不会逃到 C:\file.txt），
    // 冒号在 Windows 文件名里非法，fs 层归 not-found。这是刻意的安全行为。
    { input: "C:file.txt", expected: "ok" },
  ];
  for (const { input, expected } of cases) {
    const decision = evaluateBotWorkspaceFilePath({
      pathOps: path.win32,
      workspaceRoot: "C:\\ws",
      relativePath: input,
    });
    assert.equal(
      decision.ok,
      expected === "ok",
      `relativePath=${input} 期望 ${expected}，实际 ${JSON.stringify(decision)}`,
    );
  }
  // 平价断言：绝对-inside 与相对形式解析到同一文件。
  const absoluteForm = evaluateBotWorkspaceFilePath({
    pathOps: path.win32,
    workspaceRoot: "C:\\ws",
    relativePath: "C:\\ws\\reports\\result.png",
  });
  const relativeForm = evaluateBotWorkspaceFilePath({
    pathOps: path.win32,
    workspaceRoot: "C:\\ws",
    relativePath: "reports\\result.png",
  });
  assert.ok(absoluteForm.ok && relativeForm.ok);
  assert.equal(absoluteForm.lexicalPath, "C:\\ws\\reports\\result.png");
  assert.equal(absoluteForm.lexicalPath, relativeForm.lexicalPath);
});

test("realpath containment：符号链接逃逸与同根判定", () => {
  const params = { pathOps: path.posix, realWorkspaceRoot: "/real/ws" };
  assert.equal(isRealpathInsideWorkspace({ ...params, realFilePath: "/real/ws/a.png" }), true);
  assert.equal(isRealpathInsideWorkspace({ ...params, realFilePath: "/real/ws" }), true);
  assert.equal(isRealpathInsideWorkspace({ ...params, realFilePath: "/real/ws-out/a.png" }), false);
  assert.equal(isRealpathInsideWorkspace({ ...params, realFilePath: "/etc/passwd" }), false);
  // 前缀相同但非分隔符边界（/real/ws-extra）不得误判为包含。
  assert.equal(
    isRealpathInsideWorkspace({ ...params, realFilePath: "/real/ws-extra/a.png" }),
    false,
  );
});

test("硬上限判定：10MB 边界与增长映射", () => {
  assert.equal(BOT_WORKSPACE_FILE_HARD_CAP_BYTES, 10 * 1024 * 1024);
  assert.equal(botWorkspaceFileSizeExceedsHardCap(0), false);
  assert.equal(botWorkspaceFileSizeExceedsHardCap(BOT_WORKSPACE_FILE_HARD_CAP_BYTES), false);
  assert.equal(botWorkspaceFileSizeExceedsHardCap(BOT_WORKSPACE_FILE_HARD_CAP_BYTES + 1), true);
  // 读前 5MB（产品上限内）、读后增长越过 10MB 硬上限 → too-large 的映射依据。
  assert.equal(botWorkspaceFileSizeExceedsHardCap(5 * 1024 * 1024), false);
  assert.equal(botWorkspaceFileSizeExceedsHardCap(11 * 1024 * 1024), true);
});

test("fs 错误分类：按稳定 code 映射 not-found / unavailable", () => {
  assert.equal(classifyBotWorkspaceFileFsError({ code: "ENOENT" }), "not-found");
  assert.equal(classifyBotWorkspaceFileFsError({ code: "ENOTDIR" }), "not-found");
  assert.equal(classifyBotWorkspaceFileFsError({ code: "EISDIR" }), "not-found");
  assert.equal(classifyBotWorkspaceFileFsError({ code: "EACCES" }), "unavailable");
  assert.equal(classifyBotWorkspaceFileFsError({ code: "EIO" }), "unavailable");
  assert.equal(classifyBotWorkspaceFileFsError({ code: undefined }), "unavailable");
  assert.equal(classifyBotWorkspaceFileFsError({}), "unavailable");
});

test("AttachServicePort attachmentKind：additive 且只认 bot-runtime", () => {
  const base = {
    type: "attach-service-port",
    requestId: "req-1",
    attachmentId: "att-1",
    clientMode: "web-remote-replayable",
    scope: {
      kind: "remote",
      remoteSessionId: "rs-1",
      workspacePath: "/ws",
      workspaceIdentity: "identity-1",
    },
  };
  // 缺席（标准 renderer/relay/phone attachment）依旧合法——additive optional。
  assert.equal(hostAttachServicePortMessageSchema.safeParse(base).success, true);
  assert.equal(
    hostAttachServicePortMessageSchema.safeParse({ ...base, attachmentKind: "bot-runtime" })
      .success,
    true,
  );
  // 唯一合法值：其他字面量必须拒绝（结构性锁，不做角色启发）。
  assert.equal(
    hostAttachServicePortMessageSchema.safeParse({
      ...base,
      attachmentKind: "renderer-runtime",
    }).success,
    false,
  );
});
