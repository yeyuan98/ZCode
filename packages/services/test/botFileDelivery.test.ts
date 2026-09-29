import assert from "node:assert/strict";
import test from "node:test";
import { createDecipheriv } from "node:crypto";
import type { IDisposable } from "@zcode/rpc";
import {
  buildWeixinMediaItem,
  buildWeixinUploadRequestBody,
  encodeWeixinMediaAesKey,
  encryptWeixinCdnMediaForTest,
  weixinCdnPaddedSize,
} from "../src/bots/providers/weixinProvider.js";
import { parseBotCommand } from "../src/bots/commandParser.js";
import {
  botAllowedCommandsSchema,
  ZCODE_AGENT_PROVIDER,
  type BotActor,
  type BotOutboundAttachment,
  type BotOutboundMessage,
} from "@zcode/shared";
import {
  BOTS_CONFIG_FILE,
  BOTS_STATE_FILE,
  normalizeBotCommandPolicy,
} from "../src/bots/config.js";
import { isUserCommandAllowed } from "../src/bots/botConfigHelpers.js";
import {
  createBotShareFileQuotaTracker,
  createBotTaskDeliveryRegistry,
  createBotsService,
  inferOutboundAttachmentKind,
  inferOutboundAttachmentMime,
  mergeWeixinContextTokens,
  resolveWorkspaceFilePath,
  revalidateWorkspaceFileForDelivery,
} from "../src/bots/botsService.js";
import { zcodeBotsShareFileParamsSchema } from "@zcode/shared";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";
import type { IBotsService } from "../src/bots/bots.js";
import type { IZCodeTaskService } from "../src/session/zcodeTaskService.js";
import type { ICredentialService } from "../src/credential/credential.js";
import type { IModelSelectionService } from "../src/model-provider/providerFacadeServices.js";
import type { BotProviderAdapter } from "../src/bots/providers/types.js";
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// specs/bot-file-delivery.md §5：出站媒体协议不变量（2026-09-29 生产环境实测）。

test("weixinCdnPaddedSize: PKCS7 补齐到 16 字节边界", () => {
  assert.equal(weixinCdnPaddedSize(0), 16);
  assert.equal(weixinCdnPaddedSize(1), 16);
  assert.equal(weixinCdnPaddedSize(15), 16);
  assert.equal(weixinCdnPaddedSize(16), 32);
  assert.equal(weixinCdnPaddedSize(70), 80);
  assert.equal(weixinCdnPaddedSize(93), 96);
  assert.equal(weixinCdnPaddedSize(1_048_576), 1_048_592);
});

test("协议不变量：aes_key 是 hex 字符串的 base64（双重编码），不是原始 key 的 base64", () => {
  const aesKeyHex = "00112233445566778899aabbccddeeff";
  const encoded = encodeWeixinMediaAesKey(aesKeyHex);
  assert.equal(encoded, Buffer.from(aesKeyHex, "utf8").toString("base64"));
  // 原始 16 字节 key 的 base64（错误形态）长度 24；正确形态长度 44。
  assert.equal(encoded.length, 44);
  assert.notEqual(encoded, Buffer.from(aesKeyHex, "hex").toString("base64"));
});

test("encryptWeixinCdnMediaForTest 与 AES-128-ECB 解密互逆", () => {
  const aesKeyHex = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
  const plaintext = Buffer.from("Zodex iLink outbound media probe payload", "utf8");
  const ciphertext = encryptWeixinCdnMediaForTest(plaintext, aesKeyHex);
  assert.equal(ciphertext.length, weixinCdnPaddedSize(plaintext.length));
  const key = Buffer.from(aesKeyHex, "hex");
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  assert.deepEqual(decrypted, plaintext);
});

test("parseBotCommand 解析 /file 与 /文件", () => {
  assert.deepEqual(parseBotCommand("/file reports/result.png"), {
    type: "file",
    value: "reports/result.png",
  });
  assert.deepEqual(parseBotCommand("/文件 报告.pdf"), { type: "file", value: "报告.pdf" });
  // 缺参数：不构成 file 命令，落到 unknown，由服务层回复帮助语义。
  assert.equal(parseBotCommand("/file").type, "unknown");
  // 前缀相同但更长的命令不受影响。
  assert.equal(parseBotCommand("/filesync a").type, "unknown");
});

test("inferOutboundAttachmentKind 按扩展名路由 image/video/file", () => {
  assert.equal(inferOutboundAttachmentKind("a.png"), "image");
  assert.equal(inferOutboundAttachmentKind("b.JPG"), "image");
  assert.equal(inferOutboundAttachmentKind("c.mp4"), "video");
  assert.equal(inferOutboundAttachmentKind("d.mov"), "video");
  assert.equal(inferOutboundAttachmentKind("report.pdf"), "file");
  assert.equal(inferOutboundAttachmentKind("archive.tar.gz"), "file");
});

test("inferOutboundAttachmentMime 已知扩展名映射，未知回退按 kind", () => {
  assert.equal(inferOutboundAttachmentMime("a.png", "image"), "image/png");
  assert.equal(inferOutboundAttachmentMime("a.md", "file"), "text/markdown");
  assert.equal(inferOutboundAttachmentMime("weird.xyz", "file"), "application/octet-stream");
  assert.equal(inferOutboundAttachmentMime("weird2", "image"), "image/jpeg");
});

test("resolveWorkspaceFilePath: workspace 树内文件解析成功并返回大小", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-bot-file-"));
  try {
    await writeFile(join(root, "result.txt"), "hello zodex");
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "image.png"), Buffer.from([1, 2, 3]));
    const direct = await resolveWorkspaceFilePath(root, "result.txt");
    assert.equal(direct.ok, true);
    if (direct.ok) {
      assert.equal(direct.sizeBytes, "hello zodex".length);
      assert.equal(direct.absolutePath, join(root, "result.txt"));
    }
    const nested = await resolveWorkspaceFilePath(root, "nested/image.png");
    assert.equal(nested.ok, true);
    const absoluteInside = await resolveWorkspaceFilePath(root, join(root, "result.txt"));
    assert.equal(absoluteInside.ok, true);
    // “..” 逃逸与绝对路径逃逸都必须拒绝。
    const escapeRelative = await resolveWorkspaceFilePath(root, "../outside.txt");
    assert.equal(escapeRelative.ok, false);
    if (!escapeRelative.ok) assert.equal(escapeRelative.reason, "outside");
    const escapeAbsolute = await resolveWorkspaceFilePath(
      root,
      join(tmpdir(), "zcode-elsewhere.txt"),
    );
    assert.equal(escapeAbsolute.ok, false);
    if (!escapeAbsolute.ok) assert.equal(escapeAbsolute.reason, "outside");
    const missing = await resolveWorkspaceFilePath(root, "no-such-file.bin");
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.reason, "missing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveWorkspaceFilePath: 目录与指向树外的符号链接均被拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-bot-file-symlink-"));
  try {
    const outsideRoot = await mkdtemp(join(tmpdir(), "zcode-bot-file-outside-"));
    try {
      await writeFile(join(outsideRoot, "secret.txt"), "secret");
      await mkdir(join(root, "sub"));
      await symlink(join(root, "sub"), join(root, "dir-link"), "dir");
      await symlink(join(outsideRoot, "secret.txt"), join(root, "escape-link"), "file");
      // 目录不是可发送文件。
      const directory = await resolveWorkspaceFilePath(root, "dir-link");
      assert.equal(directory.ok, false);
      // realpath 归一化后指向 workspace 之外的符号链接必须按 outside 拒绝。
      const symlinkEscape = await resolveWorkspaceFilePath(root, "escape-link");
      assert.equal(symlinkEscape.ok, false);
      if (!symlinkEscape.ok) assert.equal(symlinkEscape.reason, "outside");
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mergeWeixinContextTokens: 更新排序并裁剪到上限", () => {
  const initial = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [
      `peer-${index}`,
      { token: `token-${index}`, updatedAt: 1_000 + index },
    ]),
  );
  const merged = mergeWeixinContextTokens(initial, "peer-new", "token-new", 9_999);
  assert.equal(Object.keys(merged).length, 20);
  assert.deepEqual(merged["peer-new"], { token: "token-new", updatedAt: 9_999 });
  // 最旧的 peer-0 被裁掉。
  assert.equal(merged["peer-0"], undefined);
  // 既有 peer 更新时间戳后保留。
  const refreshed = mergeWeixinContextTokens(merged, "peer-5", "token-5b", 10_000);
  assert.equal(Object.keys(refreshed).length, 20);
  assert.deepEqual(refreshed["peer-5"], { token: "token-5b", updatedAt: 10_000 });
});

test("协议不变量：getuploadurl 请求体字段与实测线上形状一致", () => {
  const body = buildWeixinUploadRequestBody({
    filekey: "a".repeat(32),
    mediaType: 3,
    toUserId: "peer@im.wechat",
    rawSize: 93,
    rawFileMd5: "d41d8cd98f00b204e9800998ecf8427e",
    ciphertextSize: 96,
    aesKeyHex: "0".repeat(32),
  });
  assert.deepEqual(body, {
    filekey: "a".repeat(32),
    media_type: 3,
    to_user_id: "peer@im.wechat",
    rawsize: 93,
    rawfilemd5: "d41d8cd98f00b204e9800998ecf8427e",
    // filesize 是补齐后的密文大小，不是明文大小。
    filesize: 96,
    no_need_thumb: true,
    // aeskey 是 hex 字符串，不做 base64。
    aeskey: "0".repeat(32),
  });
});

test("协议不变量：媒体 item 形状（len 字符串明文大小；mid_size/video_size 密文大小；aes_key 双重编码）", () => {
  const base = {
    filename: "report.md",
    rawSize: 93,
    ciphertextSize: 96,
    downloadParam: "download-param-value",
    aesKeyHex: "ab".repeat(16),
  };
  const fileItem = buildWeixinMediaItem({ ...base, kind: "file" });
  assert.deepEqual(fileItem, {
    type: 4,
    file_item: {
      media: {
        encrypt_query_param: "download-param-value",
        aes_key: Buffer.from("ab".repeat(16), "utf8").toString("base64"),
        encrypt_type: 1,
      },
      file_name: "report.md",
      // len 必须是字符串形式的明文大小。
      len: "93",
    },
  });
  const imageItem = buildWeixinMediaItem({ ...base, kind: "image", filename: "shot.png" });
  assert.deepEqual(imageItem, {
    type: 2,
    image_item: {
      media: {
        encrypt_query_param: "download-param-value",
        aes_key: Buffer.from("ab".repeat(16), "utf8").toString("base64"),
        encrypt_type: 1,
      },
      // mid_size 是密文大小。
      mid_size: 96,
    },
  });
  const videoItem = buildWeixinMediaItem({ ...base, kind: "video", filename: "clip.mp4" });
  assert.deepEqual(videoItem, {
    type: 5,
    video_item: {
      media: {
        encrypt_query_param: "download-param-value",
        aes_key: Buffer.from("ab".repeat(16), "utf8").toString("base64"),
        encrypt_type: 1,
      },
      video_size: 96,
    },
  });
});

test("file 命令开关：schema 接受显式 false 且策略归一化不丢开关", () => {
  // botAllowedCommandsSchema 是 strict 的；缺了 file 字段时显式 false 会让整个配置解析失败。
  const parsed = botAllowedCommandsSchema.parse({
    status: true,
    new: true,
    workspace: true,
    model: true,
    thoughtLevel: true,
    reply: true,
    file: false,
  });
  assert.equal(parsed.file, false);
  const bot = {
    id: "bot-1",
    provider: "weixin",
    enabled: true,
    allowedCommands: normalizeBotCommandPolicy(parsed),
  } as Parameters<typeof isUserCommandAllowed>[0];
  assert.equal(isUserCommandAllowed(bot, "file"), false);
  assert.equal(isUserCommandAllowed(bot, "message"), true);
  // 缺省（未配置）视为允许。
  const defaultBot = {
    id: "bot-2",
    provider: "weixin",
    enabled: true,
    allowedCommands: normalizeBotCommandPolicy(),
  } as Parameters<typeof isUserCommandAllowed>[0];
  assert.equal(isUserCommandAllowed(defaultBot, "file"), true);
});

// ---- Phase B：对话式 share_file（specs/bot-file-delivery.md Phase B）----
// 服务级测试统一通过 createBotsService 真实装配：临时 data 目录（setDataBaseDir）+
// providerOverrides 注入可观测 adapter + 预置 taskDeliveryRegistry，走与生产一致的
// 入站 → watchTaskStream 注册 → shareFileForTask 裁决链路。

type StreamEnqueue = (event: unknown) => Promise<void>;

interface SendAttachmentCall {
  botId: string;
  message: BotOutboundMessage;
  attachment: BotOutboundAttachment;
}

const WEIXIN_BOT_ID = "bot-wx";
const FEISHU_BOT_ID = "bot-fs";
const CONVERSATIONAL_TASK_ID = "task-conv-1";

function baseAllowedCommands() {
  return {
    status: true,
    new: true,
    workspace: true,
    model: true,
    thoughtLevel: true,
    reply: true,
  };
}

function buildWeixinBotConfig() {
  return {
    id: WEIXIN_BOT_ID,
    name: "WeChat Bot",
    provider: "weixin",
    enabled: true,
    providerUserId: "wx-user-1",
    allowedWorkspaces: ["*"],
    allowedCommands: baseAllowedCommands(),
    currentOptions: {},
    replyMode: "assistant_changes",
  };
}

function buildFeishuBotConfig() {
  return {
    id: FEISHU_BOT_ID,
    name: "Feishu Bot",
    provider: "feishu",
    enabled: true,
    providerUserId: "fs-user-1",
    allowedWorkspaces: ["*"],
    allowedCommands: baseAllowedCommands(),
    currentOptions: {},
    replyMode: "assistant_changes",
  };
}

interface HarnessOptions {
  weixinBot?: ReturnType<typeof buildWeixinBotConfig>;
  feishuBot?: ReturnType<typeof buildFeishuBotConfig> | null;
  workspaceIdentity?: string;
  sendAttachmentError?: Error;
}

interface Harness {
  service: IBotsService & { disposeAllAndWait(): Promise<void> };
  registry: ReturnType<typeof createBotTaskDeliveryRegistry>;
  sendAttachmentCalls: SendAttachmentCall[];
  workspacePath: string;
  outsideFilePath: string;
  getStreamEnqueue: () => StreamEnqueue | undefined;
  conversationalActor: BotActor;
  triggerConversationalMessage(options?: {
    text?: string;
    token?: string;
    messageId?: string;
    chatType?: "private" | "group";
  }): Promise<BotOutboundMessage[]>;
  sendFileCommand(
    value: string,
    options?: { token?: string; messageId?: string; provider?: "weixin" | "feishu" },
  ): Promise<BotOutboundMessage[]>;
  readRawConfig(): Promise<string>;
  readRawState(): Promise<string>;
  writeRawConfig(config: unknown): Promise<void>;
  dispose(): Promise<void>;
}

let inboundMessageCounter = 0;

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const dataRoot = await mkdtemp(join(tmpdir(), "zcode-bot-share-"));
  setDataBaseDir(dataRoot);
  const workspace = await mkdtemp(join(tmpdir(), "zcode-bot-ws-"));
  await mkdir(join(workspace, "out"), { recursive: true });
  await writeFile(join(workspace, "out", "result.txt"), "hello zodex");
  const outsideRoot = await mkdtemp(join(tmpdir(), "zcode-bot-outside-"));
  const outsideFilePath = join(outsideRoot, "secret.txt");
  await writeFile(outsideFilePath, "secret");
  const configDir = getAppConfigDir();
  await mkdir(configDir, { recursive: true });
  const bots = [
    options.weixinBot ?? buildWeixinBotConfig(),
    ...(options.feishuBot === null ? [] : [options.feishuBot ?? buildFeishuBotConfig()]),
  ];
  await writeFile(join(configDir, BOTS_CONFIG_FILE), JSON.stringify({ version: 3, bots }));
  await writeFile(
    join(configDir, BOTS_STATE_FILE),
    JSON.stringify({
      version: 3,
      bots: {
        [WEIXIN_BOT_ID]: {
          botId: WEIXIN_BOT_ID,
          workspacePath: workspace,
          ...(options.workspaceIdentity ? { workspaceIdentity: options.workspaceIdentity } : {}),
          mode: "task",
          activeTaskId: CONVERSATIONAL_TASK_ID,
          weixinActivatedAt: 1,
          updatedAt: 1,
        },
      },
    }),
  );

  const registry = createBotTaskDeliveryRegistry();
  const sendAttachmentCalls: SendAttachmentCall[] = [];
  const sendAttachmentError = options.sendAttachmentError;
  const weixinAdapter: BotProviderAdapter = {
    test: async () => ({ ok: true, message: "stub" }),
    send: async () => undefined,
    sendAttachment: async (bot, message, attachment) => {
      if (sendAttachmentError) throw sendAttachmentError;
      sendAttachmentCalls.push({ botId: bot.id, message, attachment });
    },
  };
  // feishu 覆盖为无 sendAttachment 能力的 stub：用于 unsupported-provider 判定。
  const feishuAdapter: BotProviderAdapter = {
    test: async () => ({ ok: true, message: "stub" }),
    send: async () => undefined,
  };

  let streamEnqueue: StreamEnqueue | undefined;
  const fakeTaskService = {
    listDeletedTaskIds: async () => [] as string[],
    resumeTask: async () => undefined,
    createTask: async () => ({ taskId: "task-created" }),
    deleteTask: async () => undefined,
    getTaskModelSelection: async () => ({
      providerId: ZCODE_AGENT_PROVIDER,
      modelId: "glm-test",
    }),
    getTaskConfigOptions: async () => [],
    listTasks: async () => [],
    getTaskSnapshot: async () => null,
    sendPrompt: async () => undefined,
    setMode: async () => undefined,
    onDynamicStreamEvent:
      (taskId: string) =>
      (enqueue: StreamEnqueue): IDisposable => {
        assert.equal(taskId, CONVERSATIONAL_TASK_ID);
        streamEnqueue = enqueue;
        return {
          dispose: () => {
            streamEnqueue = undefined;
          },
        };
      },
  };
  const modelSelection = { providerId: ZCODE_AGENT_PROVIDER, modelId: "glm-test" };
  const modelSelectionService = {
    getView: async () =>
      ({
        revision: 1,
        providers: [],
        preferredSelection: modelSelection,
        effectiveSelection: modelSelection,
      }) as unknown as Awaited<ReturnType<IModelSelectionService["getView"]>>,
  };
  const credentialService = {
    load: async () => null,
  } as unknown as ICredentialService;

  const service = createBotsService({
    credentialService,
    zcodeTaskService: fakeTaskService as unknown as IZCodeTaskService,
    modelSelectionService,
    runStartupBackgroundTasks: false,
    providerOverrides: { weixin: weixinAdapter, feishu: feishuAdapter },
    taskDeliveryRegistry: registry,
  });

  const conversationalActor: BotActor = {
    provider: "weixin",
    botId: WEIXIN_BOT_ID,
    providerUserId: "wx-user-1",
    chatType: "private",
    chatId: "wx-chat-1",
  };

  const buildInbound = (
    overrides: {
      text?: string;
      token?: string;
      messageId?: string;
      chatType?: "private" | "group";
      provider?: "weixin" | "feishu";
    } = {},
  ) => {
    const provider = overrides.provider ?? "weixin";
    inboundMessageCounter += 1;
    const actor: BotActor = {
      provider,
      botId: provider === "weixin" ? WEIXIN_BOT_ID : FEISHU_BOT_ID,
      providerUserId: provider === "weixin" ? "wx-user-1" : "fs-user-1",
      chatType: overrides.chatType ?? "private",
      chatId: provider === "weixin" ? "wx-chat-1" : "fs-chat-1",
      providerMessageId: overrides.messageId ?? `msg-${inboundMessageCounter}`,
      ...(overrides.token === undefined ? {} : { providerContextToken: overrides.token }),
    };
    return {
      botId: actor.botId,
      actor,
      text: overrides.text ?? "继续分析",
      receivedAt: Date.now(),
    };
  };

  return {
    service,
    registry,
    sendAttachmentCalls,
    workspacePath: workspace,
    outsideFilePath,
    getStreamEnqueue: () => streamEnqueue,
    conversationalActor,
    async triggerConversationalMessage(overrides = {}) {
      const replies = await service.handleInboundMessage(buildInbound(overrides));
      // sendPromptInBackground 是 fire-and-forget；等待微任务与定时器稳定。
      await new Promise((resolve) => setTimeout(resolve, 25));
      return replies;
    },
    async sendFileCommand(value: string, overrides = {}) {
      const replies = await service.handleInboundMessage(
        buildInbound({ text: `/file ${value}`, ...overrides }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      return replies;
    },
    readRawConfig: () => readFile(join(configDir, BOTS_CONFIG_FILE), "utf8"),
    readRawState: () => readFile(join(configDir, BOTS_STATE_FILE), "utf8"),
    async writeRawConfig(config: unknown) {
      await writeFile(join(configDir, BOTS_CONFIG_FILE), JSON.stringify(config));
    },
    async dispose() {
      await service.disposeAllAndWait().catch(() => undefined);
      setDataBaseDir(null);
      await rm(dataRoot, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
      await rm(outsideRoot, { recursive: true, force: true });
    },
  };
}

function readRegistryActorToken(call: SendAttachmentCall): string | undefined {
  return call.message.providerContextToken;
}

test("taskDeliveryRegistry：remember 有界 200 淘汰最旧，重写刷新顺序，forget/clear 生效", () => {
  const registry = createBotTaskDeliveryRegistry();
  const buildEntry = (botId: string) => ({
    botId,
    actor: { provider: "weixin", botId, providerUserId: "u", chatType: "private" },
    workspacePath: "/ws",
  });
  registry.remember("task-0", buildEntry("bot-0"));
  for (let index = 1; index <= 200; index += 1) {
    registry.remember(`task-${index}`, buildEntry(`bot-${index}`));
  }
  assert.equal(registry.size, 200);
  // task-0 是最旧条目，第 201 次写入后应被淘汰。
  assert.equal(registry.get("task-0"), undefined);
  assert.notEqual(registry.get("task-1"), undefined);
  assert.notEqual(registry.get("task-200"), undefined);
  // 重写既有 taskId 刷新插入顺序：task-1 不再是最旧。
  registry.remember("task-1", buildEntry("bot-1"));
  registry.remember("task-new", buildEntry("bot-new"));
  assert.equal(registry.get("task-2"), undefined);
  assert.notEqual(registry.get("task-1"), undefined);
  registry.forget("task-new");
  assert.equal(registry.get("task-new"), undefined);
  registry.clear();
  assert.equal(registry.size, 0);
});

test("shareFile 配额：10 分钟窗口 3 次上限，按 (botId, peerKey) 隔离", () => {
  const quota = createBotShareFileQuotaTracker();
  const t0 = 1_000_000;
  for (let index = 0; index < 3; index += 1) {
    quota.record("bot-1", "peer-1", t0 + index);
  }
  assert.equal(quota.allows("bot-1", "peer-1", t0 + 10), false);
  // 不同 (botId, peerKey) 互不影响。
  assert.equal(quota.allows("bot-1", "peer-2", t0 + 10), true);
  assert.equal(quota.allows("bot-2", "peer-1", t0 + 10), true);
  // 滚动窗口：最早一条滑出 10 分钟后恢复（此处窗口内仍有 2 条，未达 3 上限）。
  assert.equal(quota.allows("bot-1", "peer-1", t0 + 600_000 + 1), true);
});

test("shareFile 配额：1 小时窗口 20 次上限独立生效（10 分钟窗口未满时）", () => {
  const quota = createBotShareFileQuotaTracker();
  // 合成时间线：20 条记录落在 [100, 2893]，查询时刻 10 分钟窗口为空、1 小时窗口全满。
  const queryAt = 3_600_000;
  for (let index = 0; index < 20; index += 1) {
    quota.record("bot-1", "peer-1", 100 + index * 147);
  }
  assert.equal(quota.allows("bot-1", "peer-1", queryAt), false);
  // 全部记录滑出 1 小时窗口后恢复。
  assert.equal(quota.allows("bot-1", "peer-1", 100 + 3_600_000 + 20), true);
});

test("revalidateWorkspaceFileForDelivery：读取前重校验大小增长（stat 与读取之间膨胀 → too-large）", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-bot-revalidate-"));
  try {
    const growing = join(root, "growing.bin");
    await writeFile(growing, Buffer.alloc(4 * 1024 * 1024));
    const first = await revalidateWorkspaceFileForDelivery(root, growing);
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.equal(first.sizeBytes, 4 * 1024 * 1024);
    }
    // 首次 stat 后文件增长超限：读取前必须以最新大小拒绝。
    const handle = await readFile(growing);
    assert.ok(handle.byteLength > 0);
    await writeFile(growing, Buffer.concat([handle, Buffer.alloc(2 * 1024 * 1024)]));
    const second = await revalidateWorkspaceFileForDelivery(root, growing);
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.reason, "too-large");
      assert.equal(second.sizeBytes, 6 * 1024 * 1024);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("revalidateWorkspaceFileForDelivery：符号链接被替换指向树外（TOCTOU）→ outside-workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-bot-toctou-"));
  try {
    const outsideRoot = await mkdtemp(join(tmpdir(), "zcode-bot-toctou-out-"));
    try {
      await writeFile(join(outsideRoot, "leak.txt"), "leak");
      const linkPath = join(root, "swap-link");
      await symlink(join(root, "result.txt"), linkPath, "file");
      await writeFile(join(root, "result.txt"), "safe");
      // 首次校验时链接仍在树内。
      const before = await revalidateWorkspaceFileForDelivery(root, linkPath);
      assert.equal(before.ok, true);
      // 链接被替换为指向 workspace 外（symlink swap）。
      await rm(linkPath, { force: true });
      await symlink(join(outsideRoot, "leak.txt"), linkPath, "file");
      const after = await revalidateWorkspaceFileForDelivery(root, linkPath);
      assert.equal(after.ok, false);
      if (!after.ok) {
        assert.equal(after.reason, "outside-workspace");
      }
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("对话式入站消息填充 taskDeliveryRegistry（仅对话路径）", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerConversationalMessage({ token: "token-captured" });
    const entry = harness.registry.get(CONVERSATIONAL_TASK_ID);
    assert.ok(entry, "对话式消息触发的任务必须登记投递目标");
    assert.equal(entry.botId, WEIXIN_BOT_ID);
    assert.equal(entry.workspacePath, harness.workspacePath);
    assert.equal(entry.actor.chatId, "wx-chat-1");
    assert.equal(entry.workspaceIdentity, undefined);
  } finally {
    await harness.dispose();
  }
});

test("watchAutomationRun 删除既有投递目标（automation 复用 → no-target）", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerConversationalMessage({ token: "token-captured" });
    assert.ok(harness.registry.get(CONVERSATIONAL_TASK_ID));
    await harness.service.watchAutomationRun({
      target: {
        provider: "weixin",
        botId: WEIXIN_BOT_ID,
        providerUserId: "wx-user-1",
        chatType: "private",
      },
      taskId: CONVERSATIONAL_TASK_ID,
      workspacePath: harness.workspacePath,
    });
    assert.equal(harness.registry.get(CONVERSATIONAL_TASK_ID), undefined);
    const result = await harness.service.shareFileForTask({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "out/result.txt",
    });
    assert.deepEqual(result, { ok: false, reason: "no-target" });
    assert.equal(harness.sendAttachmentCalls.length, 0);
  } finally {
    await harness.dispose();
  }
});

test("流终态清理投递目标（晚到 RPC → no-target）", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerConversationalMessage({ token: "token-captured" });
    const enqueue = harness.getStreamEnqueue();
    assert.ok(enqueue, "对话式任务必须已订阅任务流");
    await enqueue({ type: "task_complete", taskId: CONVERSATIONAL_TASK_ID });
    assert.equal(harness.registry.get(CONVERSATIONAL_TASK_ID), undefined);
    const result = await harness.service.shareFileForTask({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "out/result.txt",
    });
    assert.deepEqual(result, { ok: false, reason: "no-target" });
  } finally {
    await harness.dispose();
  }
});

test("shareFileForTask：注册表未命中（未知任务）→ no-target", async () => {
  const harness = await createHarness();
  try {
    const result = await harness.service.shareFileForTask({
      taskId: "task-unknown",
      path: "out/result.txt",
    });
    assert.deepEqual(result, { ok: false, reason: "no-target" });
    assert.equal(harness.sendAttachmentCalls.length, 0);
  } finally {
    await harness.dispose();
  }
});

test("shareFileForTask：happy path 走单一写出核心，adapter 恰好投递一次", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerConversationalMessage({ token: "token-captured" });
    const result = await harness.service.shareFileForTask({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "out/result.txt",
    });
    assert.deepEqual(result, { ok: true, filename: "result.txt", sizeBytes: "hello zodex".length });
    assert.equal(harness.sendAttachmentCalls.length, 1);
    assert.equal(
      harness.sendAttachmentCalls[0].attachment.localPath,
      join(harness.workspacePath, "out", "result.txt"),
    );
  } finally {
    await harness.dispose();
  }
});

test("shareFileForTask 守卫矩阵：bot 中途禁用 → not-allowed", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerConversationalMessage();
    const rawConfig = JSON.parse(await harness.readRawConfig());
    rawConfig.bots[0].enabled = false;
    await harness.writeRawConfig(rawConfig);
    const result = await harness.service.shareFileForTask({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "out/result.txt",
    });
    assert.deepEqual(result, { ok: false, reason: "not-allowed" });
    assert.equal(harness.sendAttachmentCalls.length, 0);
  } finally {
    await harness.dispose();
  }
});

test("shareFileForTask 守卫矩阵：allowedCommands.file 中途关闭 → not-allowed", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerConversationalMessage();
    const rawConfig = JSON.parse(await harness.readRawConfig());
    rawConfig.bots[0].allowedCommands.file = false;
    await harness.writeRawConfig(rawConfig);
    const result = await harness.service.shareFileForTask({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "out/result.txt",
    });
    assert.deepEqual(result, { ok: false, reason: "not-allowed" });
    assert.equal(harness.sendAttachmentCalls.length, 0);
  } finally {
    await harness.dispose();
  }
});

test("shareFileForTask 守卫矩阵：用户解绑（providerUserId 变更）→ not-allowed", async () => {
  const harness = await createHarness();
  try {
    // 直接登记 feishu 会话目标，随后改绑 providerUserId，模拟中途解绑。
    harness.registry.remember(CONVERSATIONAL_TASK_ID, {
      botId: FEISHU_BOT_ID,
      actor: {
        provider: "feishu",
        botId: FEISHU_BOT_ID,
        providerUserId: "fs-user-1",
        chatType: "private",
      },
      workspacePath: harness.workspacePath,
    });
    const rawConfig = JSON.parse(await harness.readRawConfig());
    rawConfig.bots[1].providerUserId = "fs-someone-else";
    await harness.writeRawConfig(rawConfig);
    const result = await harness.service.shareFileForTask({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "out/result.txt",
    });
    assert.deepEqual(result, { ok: false, reason: "not-allowed" });
    assert.equal(harness.sendAttachmentCalls.length, 0);
  } finally {
    await harness.dispose();
  }
});

test("shareFileForTask 守卫矩阵：群聊 actor → not-allowed", async () => {
  const harness = await createHarness();
  try {
    harness.registry.remember(CONVERSATIONAL_TASK_ID, {
      botId: WEIXIN_BOT_ID,
      actor: { ...harness.conversationalActor, chatType: "group" },
      workspacePath: harness.workspacePath,
    });
    const result = await harness.service.shareFileForTask({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "out/result.txt",
    });
    assert.deepEqual(result, { ok: false, reason: "not-allowed" });
    assert.equal(harness.sendAttachmentCalls.length, 0);
  } finally {
    await harness.dispose();
  }
});

test("shareFileForTask 守卫矩阵：adapter 无 sendAttachment（feishu/lark）→ unsupported-provider", async () => {
  const harness = await createHarness();
  try {
    harness.registry.remember(CONVERSATIONAL_TASK_ID, {
      botId: FEISHU_BOT_ID,
      actor: {
        provider: "feishu",
        botId: FEISHU_BOT_ID,
        providerUserId: "fs-user-1",
        chatType: "private",
      },
      workspacePath: harness.workspacePath,
    });
    const result = await harness.service.shareFileForTask({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "out/result.txt",
    });
    assert.deepEqual(result, { ok: false, reason: "unsupported-provider" });
    assert.equal(harness.sendAttachmentCalls.length, 0);
  } finally {
    await harness.dispose();
  }
});

test("shareFileForTask 守卫矩阵：远程 workspace → remote-workspace，无本地读取兜底", async () => {
  const harness = await createHarness();
  try {
    harness.registry.remember(CONVERSATIONAL_TASK_ID, {
      botId: WEIXIN_BOT_ID,
      actor: harness.conversationalActor,
      workspacePath: harness.workspacePath,
      workspaceIdentity: "remote-identity-1",
    });
    const result = await harness.service.shareFileForTask({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "out/result.txt",
    });
    assert.deepEqual(result, { ok: false, reason: "remote-workspace" });
    assert.equal(harness.sendAttachmentCalls.length, 0);
  } finally {
    await harness.dispose();
  }
});

test("shareFileForTask 守卫矩阵：词法 ..、绝对路径、符号链接逃逸 → outside-workspace", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerConversationalMessage();
    await symlink(harness.outsideFilePath, join(harness.workspacePath, "escape-link"), "file");
    const paths = [`../${join(tmpdir(), "not-relevant")}`, harness.outsideFilePath, "escape-link"];
    for (const path of paths) {
      const result = await harness.service.shareFileForTask({
        taskId: CONVERSATIONAL_TASK_ID,
        path,
      });
      assert.equal(result.ok, false, `path=${path}`);
      if (!result.ok) {
        assert.equal(result.reason, "outside-workspace", `path=${path}`);
      }
    }
    assert.equal(harness.sendAttachmentCalls.length, 0);
  } finally {
    await harness.dispose();
  }
});

test("shareFileForTask 守卫矩阵：文件不存在 → not-found；超过 5MB → too-large", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerConversationalMessage();
    const missing = await harness.service.shareFileForTask({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "no-such-file.bin",
    });
    assert.deepEqual(missing, { ok: false, reason: "not-found" });
    await writeFile(join(harness.workspacePath, "big.bin"), Buffer.alloc(5 * 1024 * 1024 + 1));
    const tooLarge = await harness.service.shareFileForTask({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "big.bin",
    });
    assert.equal(tooLarge.ok, false);
    if (!tooLarge.ok) {
      assert.equal(tooLarge.reason, "too-large");
    }
    assert.equal(harness.sendAttachmentCalls.length, 0);
  } finally {
    await harness.dispose();
  }
});

test("shareFileForTask 守卫矩阵：adapter 抛错 → send-failed（仅一次调用）", async () => {
  const harness = await createHarness({ sendAttachmentError: new Error("provider down") });
  try {
    await harness.triggerConversationalMessage();
    const result = await harness.service.shareFileForTask({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "out/result.txt",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "send-failed");
      assert.equal(result.detail, "provider down");
    }
    assert.equal(harness.sendAttachmentCalls.length, 0);
  } finally {
    await harness.dispose();
  }
});

test("shareFile quota：10 分钟内第 4 次 tool 投递被拒；/file 不受限", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerConversationalMessage();
    for (let index = 0; index < 3; index += 1) {
      const result = await harness.service.shareFileForTask({
        taskId: CONVERSATIONAL_TASK_ID,
        path: "out/result.txt",
      });
      assert.equal(result.ok, true, `delivery ${index + 1}`);
    }
    assert.equal(harness.sendAttachmentCalls.length, 3);
    const fourth = await harness.service.shareFileForTask({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "out/result.txt",
    });
    assert.deepEqual(fourth, { ok: false, reason: "quota-exceeded" });
    // 配额拒绝发生在任何文件 IO 之前：adapter 调用数不变。
    assert.equal(harness.sendAttachmentCalls.length, 3);
    // /file 永不受配额限制：连续 25 次全部尝试投递。
    for (let index = 0; index < 25; index += 1) {
      const replies = await harness.sendFileCommand("out/result.txt");
      assert.match(replies[0].text, /^已发送 result\.txt（\d+B）。$/);
    }
    assert.equal(harness.sendAttachmentCalls.length, 28);
  } finally {
    await harness.dispose();
  }
});

test("单一写出核心：/file 失败零投递且回复文案保持既有本地化（pin 既有字符串）", async () => {
  const harness = await createHarness();
  try {
    const outside = await harness.sendFileCommand("../../outside.txt");
    assert.equal(outside[0].text, "只能发送当前 workspace 内的文件：../../outside.txt");
    const missing = await harness.sendFileCommand("missing.bin");
    assert.equal(missing[0].text, "文件不存在或不可读：missing.bin");
    const sent = await harness.sendFileCommand("out/result.txt");
    assert.equal(sent[0].text, "已发送 result.txt（11B）。");
    assert.equal(harness.sendAttachmentCalls.length, 1);
  } finally {
    await harness.dispose();
  }
});

test("严格 schema：携带 recipient/provider/peer 字段的请求在进入投递前被拒绝", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerConversationalMessage();
    const injected = zcodeBotsShareFileParamsSchema.safeParse({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "out/result.txt",
      provider: "weixin",
      botId: WEIXIN_BOT_ID,
      peerUserId: "attacker@im.wechat",
    });
    assert.equal(injected.success, false, "未知键必须被 strict schema 拒绝");
    assert.equal(harness.sendAttachmentCalls.length, 0);
  } finally {
    await harness.dispose();
  }
});

test("无上下文改写：一次 share_file 投递不产生任何 bot 状态/配置写入", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerConversationalMessage({ token: "token-captured" });
    const stateBefore = await harness.readRawState();
    const configBefore = await harness.readRawConfig();
    const result = await harness.service.shareFileForTask({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "out/result.txt",
    });
    assert.equal(result.ok, true);
    assert.equal(await harness.readRawState(), stateBefore);
    assert.equal(await harness.readRawConfig(), configBefore);
  } finally {
    await harness.dispose();
  }
});

test("token 偏好：tool 取最新持久化 token 覆盖陈旧捕获 token；/file 保持消息内 token 优先", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerConversationalMessage({ token: "token-captured" });
    // 任务执行中的用户 ping（/status）刷新持久化 token 表，但不刷新注册表里的捕获 actor。
    await harness.sendFileCommand("out/result.txt", { token: "token-cmd" }).then(() => undefined);
    // 用一条无 token 的 /status ping 刷新持久化 token。
    await harness.service.handleInboundMessage({
      botId: WEIXIN_BOT_ID,
      actor: {
        provider: "weixin",
        botId: WEIXIN_BOT_ID,
        providerUserId: "wx-user-1",
        chatType: "private",
        chatId: "wx-chat-1",
        providerContextToken: "token-refreshed",
        providerMessageId: "msg-ping",
      },
      text: "/status",
    });
    const toolResult = await harness.service.shareFileForTask({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "out/result.txt",
    });
    assert.equal(toolResult.ok, true);
    const toolCall = harness.sendAttachmentCalls.at(-1);
    assert.ok(toolCall);
    assert.equal(readRegistryActorToken(toolCall), "token-refreshed");
    // /file：消息自带 token 优先于持久化 token（此处持久化为 token-refreshed）。
    const commandReplies = await harness.sendFileCommand("out/result.txt", {
      token: "token-per-message",
    });
    assert.match(commandReplies[0].text, /^已发送/);
    const commandCall = harness.sendAttachmentCalls.at(-1);
    assert.ok(commandCall);
    assert.equal(readRegistryActorToken(commandCall), "token-per-message");
    // /file：消息无 token 时回退到持久化 token。
    await harness.sendFileCommand("out/result.txt", { token: undefined });
    const fallbackCall = harness.sendAttachmentCalls.at(-1);
    assert.ok(fallbackCall);
    assert.equal(readRegistryActorToken(fallbackCall), "token-per-message");
  } finally {
    await harness.dispose();
  }
});

test("审计增强：tool 投递的 info 日志包含 source=tool、task 与 workspace 相对路径", async () => {
  const harness = await createHarness();
  const originalLog = console.log;
  const originalWarn = console.warn;
  const captured: string[] = [];
  console.log = (...args: unknown[]) => {
    captured.push(args.map((item) => String(item)).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    captured.push(args.map((item) => String(item)).join(" "));
  };
  try {
    await harness.triggerConversationalMessage({ token: "token-captured" });
    captured.length = 0;
    const result = await harness.service.shareFileForTask({
      taskId: CONVERSATIONAL_TASK_ID,
      path: "out/result.txt",
    });
    assert.equal(result.ok, true);
    const auditLine = captured.find((line) => line.includes("bot file delivery"));
    assert.ok(auditLine, "必须留下投递审计日志");
    assert.match(auditLine, /source=tool/);
    assert.match(auditLine, new RegExp(`task=${CONVERSATIONAL_TASK_ID}`));
    assert.match(auditLine, /path=out\/result\.txt/);
    assert.match(auditLine, /outcome=ok/);
    // 命令路径审计带 source=command。
    captured.length = 0;
    await harness.sendFileCommand("out/result.txt");
    const commandLine = captured.find((line) => line.includes("bot file delivery"));
    assert.ok(commandLine);
    assert.match(commandLine, /source=command/);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    await harness.dispose();
  }
});

test("disposeAllAndWait 清空投递注册表（Host 关闭后 fail-closed）", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerConversationalMessage();
    assert.ok(harness.registry.get(CONVERSATIONAL_TASK_ID));
    await harness.service.disposeAllAndWait();
    assert.equal(harness.registry.size, 0);
  } finally {
    await harness.dispose();
  }
});
