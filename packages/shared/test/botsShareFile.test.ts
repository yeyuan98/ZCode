import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SHARE_FILE_TOOL_NAME,
  botShareFileFailureReasonSchema,
  botShareFileResultSchema,
  type BotShareFileFailureReason,
} from "../src/bots.ts";
import {
  zcodeBotsShareFileParamsSchema,
  zcodeBotsShareFileResultSchema,
} from "../src/zcode-protocol/bots-share-file.ts";

/**
 * 契约（specs/bot-file-delivery.md Phase B）：
 *
 * `bots/shareFile` 请求严格只允许 { taskId, path }——收件人由 Host 从
 * taskDeliveryRegistry 解析，任何客户端提供的 target/provider/peer 字段都必须被
 * strict schema 拒绝（prompt-injection 防线，验收场景 4）。响应是
 * BotShareFileResult 判别联合，每个 failure reason 都必须能原样往返。
 */

test("share_file 请求 schema 拒绝任何收件人/多余字段（strict）", () => {
  const valid = zcodeBotsShareFileParamsSchema.safeParse({
    taskId: "task-1",
    path: "reports/result.png",
  });
  assert.equal(valid.success, true);

  const forbiddenPayloads = [
    { taskId: "task-1", path: "a.txt", provider: "weixin" },
    { taskId: "task-1", path: "a.txt", botId: "bot-1" },
    { taskId: "task-1", path: "a.txt", peer: "user-1" },
    { taskId: "task-1", path: "a.txt", providerUserId: "user-1" },
    { taskId: "task-1", path: "a.txt", chatType: "private" },
    { taskId: "task-1", path: "a.txt", recipient: "wxid_123" },
    { taskId: "task-1", path: "a.txt", caption: "look" },
  ];
  for (const payload of forbiddenPayloads) {
    const parsed = zcodeBotsShareFileParamsSchema.safeParse(payload);
    assert.equal(parsed.success, false, `应拒绝未知键：${JSON.stringify(payload)}`);
  }
});

test("share_file 请求 schema 拒绝空/空白 taskId 与 path", () => {
  for (const payload of [
    { taskId: "", path: "a.txt" },
    { taskId: "   ", path: "a.txt" },
    { taskId: "task-1", path: "" },
    { taskId: "task-1", path: "   " },
    { taskId: "task-1" },
    { path: "a.txt" },
  ]) {
    const parsed = zcodeBotsShareFileParamsSchema.safeParse(payload);
    assert.equal(parsed.success, false, `应拒绝无效载荷：${JSON.stringify(payload)}`);
  }
});

test("BotShareFileResult 响应联合按每个 failure reason 往返", () => {
  const reasons = botShareFileFailureReasonSchema.options;
  assert.equal(reasons.length, 11);
  for (const reason of reasons as readonly BotShareFileFailureReason[]) {
    const wireFailure = { ok: false, reason, detail: `detail for ${reason}` };
    const parsed = zcodeBotsShareFileResultSchema.safeParse(wireFailure);
    assert.equal(parsed.success, true, `响应 schema 应接受 reason=${reason}`);
    assert.deepEqual(parsed.success && parsed.data, wireFailure);

    // detail 是可选的：裸 reason 也要通过。
    const bare = zcodeBotsShareFileResultSchema.safeParse({ ok: false, reason });
    assert.equal(bare.success, true, `裸 reason=${reason} 应通过`);
  }

  const wireOk = { ok: true, filename: "result.png", sizeBytes: 1234 };
  const parsedOk = zcodeBotsShareFileResultSchema.safeParse(wireOk);
  assert.equal(parsedOk.success, true);
  assert.deepEqual(parsedOk.success && parsedOk.data, wireOk);
});

test("BotShareFileResult 响应联合拒绝非法形状", () => {
  for (const payload of [
    { ok: true, filename: "a.png" }, // 缺 sizeBytes
    { ok: true, filename: "", sizeBytes: 1 }, // 空 filename
    { ok: true, filename: "a.png", sizeBytes: -1 }, // 负 sizeBytes
    { ok: true, filename: "a.png", sizeBytes: 1.5 }, // 非整数
    { ok: false, reason: "made-up-reason" }, // 未知 reason
    { ok: false }, // 缺 reason
    { ok: false, reason: "not-found", detail: 42 }, // detail 非字符串
    { ok: true, filename: "a.png", sizeBytes: 1, extra: 1 }, // 成功分支未知键
    { ok: false, reason: "not-found", peer: "user-1" }, // 失败分支未知键
  ]) {
    const parsed = botShareFileResultSchema.safeParse(payload);
    assert.equal(parsed.success, false, `应拒绝非法载荷：${JSON.stringify(payload)}`);
  }
});

test("share_file 工具名与方法名常量对齐契约", async () => {
  assert.equal(SHARE_FILE_TOOL_NAME, "share_file");
  // 协议响应 schema 与 bots.ts 单一来源是同一实例（防两处漂移）。
  assert.equal(zcodeBotsShareFileResultSchema, botShareFileResultSchema);
  // barrel 在 node --test 环境会连带加载 strip-only 不支持的 model-option-map
  // （同 zcodeProtocolP4Purge.test.ts 的说明），方法名表与 barrel 再导出按既有源码扫描模式断言。
  const protocolSource = await readFile(
    new URL("../src/zcode-protocol/index.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    protocolSource.includes('botsShareFile: "bots/shareFile"'),
    true,
    "方法名表必须注册 bots/shareFile",
  );
  assert.equal(
    protocolSource.includes("export {\n  zcodeBotsShareFileParamsSchema"),
    true,
    "barrel 必须再导出 bots-share-file 叶子模块的 schema",
  );
});
