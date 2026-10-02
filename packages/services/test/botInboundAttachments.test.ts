import assert from "node:assert/strict";
import test from "node:test";
import type { IDisposable } from "@zcode/rpc";
import {
  ZCODE_AGENT_PROVIDER,
  type BotActor,
  type BotInboundAttachment,
  type BotOutboundAttachment,
  type BotOutboundMessage,
  type ZCodeAutomationBotDeliveryTarget,
  type ZCodePromptAttachment,
} from "@zcode/shared";
import { BOTS_CONFIG_FILE, BOTS_STATE_FILE } from "../src/bots/config.js";
import { createBotsService } from "../src/bots/botsService.js";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";
import type { IBotsService } from "../src/bots/bots.js";
import type { IZCodeTaskService } from "../src/session/zcodeTaskService.js";
import type { ICredentialService } from "../src/credential/credential.js";
import type { IModelSelectionService } from "../src/model-provider/providerFacadeServices.js";
import type { BotProviderAdapter } from "../src/bots/providers/types.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// specs/bot-file-delivery.md「Inbound remote workspaces (3.14.5 Alpha 0)」：
// A1 —— 入站 file/pdf/video 也必须成为真实 prompt attachments（localPath + sizeBytes，
// 无 dataBase64），image/audio 行为逐字节不变；远程上下文消息携带 attachments 进入
// sendPrompt（desktop host 包装器的输入）。A3a —— /file 先回 ack，投递在后台执行，
// 不阻塞同一 actor 的后续入站命令；后台失败经 sendOutbound 回复且绝不抛入 polling loop。

const WEIXIN_BOT_ID = "bot-wx";
const CONVERSATIONAL_TASK_ID = "task-conv-1";
/** messages.ts fileFetchStarted（zh）——A3a ack 文案的钉住值。 */
const FILE_FETCH_STARTED_ZH = "正在获取并发送文件…";

type StreamEnqueue = (event: unknown) => Promise<void>;

interface SendPromptCapture {
  taskId: string;
  content: string;
  attachments: ZCodePromptAttachment[] | undefined;
  botDeliveryTarget: ZCodeAutomationBotDeliveryTarget | undefined;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitForCondition(
  condition: () => boolean,
  timeoutMs = 2000,
  label = "condition",
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      assert.fail(`等待超时：${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function inboundAttachment(
  kind: BotInboundAttachment["kind"],
  filename: string,
  mimeType: string,
  data: Buffer,
): BotInboundAttachment {
  return {
    id: `att-${filename}`,
    kind,
    filename,
    mimeType,
    dataBase64: data.toString("base64"),
  };
}

interface HarnessOptions {
  /** 远程 workspace 上下文（isConnected=true + fake runtime services 全注入）。 */
  workspaceIdentity?: string;
  /** sendAttachment 等在一个手动 deferred 上（A3a 慢投递测试）。 */
  gateDelivery?: boolean;
}

interface Harness {
  service: IBotsService & { disposeAllAndWait(): Promise<void> };
  sendPromptCalls: SendPromptCapture[];
  sendAttachmentCalls: Array<{ botId: string; attachment: BotOutboundAttachment }>;
  /** adapter.send（后台 sendOutbound 回复）捕获序列。 */
  sentMessages: BotOutboundMessage[];
  deliveryGate: Deferred | undefined;
  triggerMessage(options: {
    text?: string;
    attachments?: BotInboundAttachment[];
  }): Promise<BotOutboundMessage[]>;
  dispose(): Promise<void>;
}

let inboundMessageCounter = 0;

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const dataRoot = await mkdtemp(join(tmpdir(), "zcode-bot-inbound-"));
  setDataBaseDir(dataRoot);
  const workspace = await mkdtemp(join(tmpdir(), "zcode-bot-inbound-ws-"));
  await mkdir(join(workspace, "out"), { recursive: true });
  await writeFile(join(workspace, "out", "result.txt"), "hello zodex");
  const configDir = getAppConfigDir();
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, BOTS_CONFIG_FILE),
    JSON.stringify({
      version: 3,
      bots: [
        {
          id: WEIXIN_BOT_ID,
          name: "WeChat Bot",
          provider: "weixin",
          enabled: true,
          providerUserId: "wx-user-1",
          allowedWorkspaces: ["*"],
          allowedCommands: {
            status: true,
            new: true,
            workspace: true,
            model: true,
            thoughtLevel: true,
            reply: true,
            file: true,
          },
          currentOptions: {},
          replyMode: "assistant_changes",
        },
      ],
    }),
  );
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

  const sendPromptCalls: SendPromptCapture[] = [];
  const sendAttachmentCalls: Array<{ botId: string; attachment: BotOutboundAttachment }> = [];
  const sentMessages: BotOutboundMessage[] = [];
  const deliveryGate = options.gateDelivery ? createDeferred() : undefined;
  const weixinAdapter: BotProviderAdapter = {
    test: async () => ({ ok: true, message: "stub" }),
    send: async (_bot, message) => {
      sentMessages.push(message);
    },
    sendAttachment: async (bot, _message, attachment) => {
      if (deliveryGate) {
        await deliveryGate.promise;
      }
      sendAttachmentCalls.push({ botId: bot.id, attachment });
    },
  };

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
    sendPrompt: async (request: {
      taskId: string;
      content: string;
      attachments?: ZCodePromptAttachment[];
      botDeliveryTarget?: ZCodeAutomationBotDeliveryTarget;
    }) => {
      sendPromptCalls.push({
        taskId: request.taskId,
        content: request.content,
        attachments: request.attachments,
        botDeliveryTarget: request.botDeliveryTarget,
      });
    },
    setMode: async () => undefined,
    onDynamicStreamEvent:
      (taskId: string) =>
      (_enqueue: StreamEnqueue): IDisposable => {
        assert.ok(
          taskId === CONVERSATIONAL_TASK_ID || taskId === "task-created",
          `unexpected stream taskId: ${taskId}`,
        );
        return { dispose: () => undefined };
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
    providerOverrides: { weixin: weixinAdapter },
    ...(options.workspaceIdentity
      ? {
          remoteWorkspaceService: {
            isConnected: async () => true,
            getZCodeTaskService: async () => fakeTaskService,
            getModelSelectionService: async () => modelSelectionService,
          },
        }
      : {}),
  });

  const buildInbound = (overrides: { text?: string; attachments?: BotInboundAttachment[] }) => {
    inboundMessageCounter += 1;
    const actor: BotActor = {
      provider: "weixin",
      botId: WEIXIN_BOT_ID,
      providerUserId: "wx-user-1",
      chatType: "private",
      chatId: "wx-chat-1",
      providerMessageId: `msg-${inboundMessageCounter}`,
    };
    return {
      botId: actor.botId,
      actor,
      text: overrides.text ?? "继续分析",
      ...(overrides.attachments ? { attachments: overrides.attachments } : {}),
      receivedAt: Date.now(),
    };
  };

  return {
    service,
    sendPromptCalls,
    sendAttachmentCalls,
    sentMessages,
    deliveryGate,
    async triggerMessage(overrides = {}) {
      const replies = await service.handleInboundMessage(buildInbound(overrides));
      // sendPromptInBackground 是 fire-and-forget；等待微任务与定时器稳定。
      await new Promise((resolve) => setTimeout(resolve, 25));
      return replies;
    },
    async dispose() {
      await service.disposeAllAndWait().catch(() => undefined);
      setDataBaseDir(null);
      await rm(dataRoot, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    },
  };
}

function lastSendPrompt(harness: Harness): SendPromptCapture {
  const capture = harness.sendPromptCalls.at(-1);
  assert.ok(capture, "sendPrompt 必须被调用");
  return capture;
}

// ---- A1：file/pdf/video 成为真实 prompt attachments ----

test("A1 入站 file/pdf/video 附件成为 prompt attachments（localPath + kind + sizeBytes，无 dataBase64）", async () => {
  const harness = await createHarness();
  try {
    const fileData = Buffer.from("plain text notes");
    const pdfData = Buffer.from("%PDF-1.4 fake pdf body");
    const videoData = Buffer.from("fake-mp4-bytes-0123456789");
    await harness.triggerMessage({
      attachments: [
        inboundAttachment("file", "notes.txt", "text/plain", fileData),
        inboundAttachment("file", "report.pdf", "application/pdf", pdfData),
        inboundAttachment("video", "clip.mp4", "video/mp4", videoData),
      ],
    });
    const capture = lastSendPrompt(harness);
    assert.ok(capture.attachments, "file/pdf/video 必须产出 prompt attachments");
    assert.equal(capture.attachments.length, 3);

    const fileAttachment = capture.attachments.find((item) => item.filename === "notes.txt");
    assert.ok(fileAttachment, "file 附件必须存在");
    assert.equal(fileAttachment.kind, "file");
    assert.equal(fileAttachment.mimeType, "text/plain");
    assert.equal(fileAttachment.sizeBytes, fileData.byteLength);
    assert.ok(fileAttachment.localPath, "file 附件必须携带缓存 localPath");
    assert.equal("dataBase64" in fileAttachment, false, "新 kind 不得携带 dataBase64");

    // pdf 由 mimeType 推导（BotInboundAttachmentKind 无 pdf；CLI mapper 对 pdf 有专门处理）。
    const pdfAttachment = capture.attachments.find((item) => item.filename === "report.pdf");
    assert.ok(pdfAttachment, "pdf 附件必须存在");
    assert.equal(pdfAttachment.kind, "pdf");
    assert.equal(pdfAttachment.mimeType, "application/pdf");
    assert.equal(pdfAttachment.sizeBytes, pdfData.byteLength);
    assert.ok(pdfAttachment.localPath);
    assert.equal("dataBase64" in pdfAttachment, false);

    const videoAttachment = capture.attachments.find((item) => item.filename === "clip.mp4");
    assert.ok(videoAttachment, "video 附件必须存在");
    assert.equal(videoAttachment.kind, "video");
    assert.equal(videoAttachment.mimeType, "video/mp4");
    assert.equal(videoAttachment.sizeBytes, videoData.byteLength);
    assert.ok(videoAttachment.localPath);
    assert.equal("dataBase64" in videoAttachment, false);

    // 既有 prompt 行仍在（远程包装器会改写其中的路径子串）。
    assert.match(capture.content, /附件：notes\.txt \(text\/plain, \d+B\)，已保存到：/u);
    for (const item of capture.attachments) {
      assert.ok(
        capture.content.includes(item.localPath ?? ""),
        `prompt 文本必须包含缓存路径：${item.filename}`,
      );
    }
  } finally {
    await harness.dispose();
  }
});

test("A1 回归：image/audio prompt attachments 行为逐字节不变（dataBase64 + localPath 保留）", async () => {
  const harness = await createHarness();
  try {
    const imageData = Buffer.from([1, 2, 3, 4]);
    const audioData = Buffer.from("fake-audio-bytes");
    await harness.triggerMessage({
      attachments: [
        inboundAttachment("image", "shot.png", "image/png", imageData),
        inboundAttachment("audio", "voice.mp3", "audio/mpeg", audioData),
      ],
    });
    const capture = lastSendPrompt(harness);
    assert.ok(capture.attachments);
    assert.equal(capture.attachments.length, 2);

    const imageAttachment = capture.attachments.find((item) => item.filename === "shot.png");
    assert.ok(imageAttachment);
    assert.equal(imageAttachment.kind, "image");
    assert.equal(imageAttachment.mimeType, "image/png");
    assert.equal(imageAttachment.dataBase64, imageData.toString("base64"));
    assert.ok(imageAttachment.localPath);

    const audioAttachment = capture.attachments.find((item) => item.filename === "voice.mp3");
    assert.ok(audioAttachment);
    assert.equal(audioAttachment.kind, "audio");
    assert.equal(audioAttachment.mimeType, "audio/mpeg");
    assert.equal(audioAttachment.dataBase64, audioData.toString("base64"));
    assert.ok(audioAttachment.localPath);

    assert.match(capture.content, /已作为图片输入提供/u);
    assert.match(capture.content, /已作为音频输入提供/u);
  } finally {
    await harness.dispose();
  }
});

test("A1 远程上下文：消息携带 attachments 进入 sendPrompt（desktop 远程包装器的输入）", async () => {
  const harness = await createHarness({ workspaceIdentity: "remote-identity-a1" });
  try {
    const pdfData = Buffer.from("%PDF-1.7 remote pdf");
    await harness.triggerMessage({
      attachments: [inboundAttachment("file", "remote-report.pdf", "application/pdf", pdfData)],
    });
    const capture = lastSendPrompt(harness);
    // 修复前：远程上下文的 file 附件不产生 prompt attachment，desktop 路径原样进入远端 prompt。
    assert.ok(capture.attachments, "远程上下文消息必须携带 attachments");
    assert.equal(capture.attachments.length, 1);
    assert.equal(capture.attachments[0].kind, "pdf");
    assert.ok(capture.attachments[0].localPath);
    assert.equal(capture.attachments[0].sizeBytes, pdfData.byteLength);
  } finally {
    await harness.dispose();
  }
});

// ---- A3a：/file ack-first 后台投递 ----

test("A3a /file 不阻塞队列：ack 立即返回，/status 在投递在途时完成，结果在投递结束后到达", async () => {
  const harness = await createHarness({ gateDelivery: true });
  try {
    const gate = harness.deliveryGate;
    assert.ok(gate, "gateDelivery 必须创建 deferred");
    const ackReplies = await withTimeout(
      harness.service.handleInboundMessage({
        botId: WEIXIN_BOT_ID,
        actor: {
          provider: "weixin",
          botId: WEIXIN_BOT_ID,
          providerUserId: "wx-user-1",
          chatType: "private",
          chatId: "wx-chat-1",
          providerMessageId: "msg-file-slow",
        },
        text: "/file out/result.txt",
        receivedAt: Date.now(),
      }),
      1000,
      "/file ack 必须立即返回（不被慢投递阻塞）",
    );
    assert.equal(ackReplies.length, 1);
    assert.equal(ackReplies[0].text, FILE_FETCH_STARTED_ZH);
    assert.equal(harness.sendAttachmentCalls.length, 0, "投递仍在途");
    assert.equal(harness.sentMessages.length, 0, "结果回复不得早于投递完成");

    // 同一 actor 的第二条入站命令在投递在途时必须完成（修复前会被串行队列阻塞）。
    const statusReplies = await withTimeout(
      harness.service.handleInboundMessage({
        botId: WEIXIN_BOT_ID,
        actor: {
          provider: "weixin",
          botId: WEIXIN_BOT_ID,
          providerUserId: "wx-user-1",
          chatType: "private",
          chatId: "wx-chat-1",
          providerMessageId: "msg-status-during-file",
        },
        text: "/status",
        receivedAt: Date.now(),
      }),
      1000,
      "/status 不得排在慢 /file 之后",
    );
    assert.ok(statusReplies.length > 0);
    assert.notEqual(statusReplies[0].text, FILE_FETCH_STARTED_ZH);
    assert.equal(harness.sentMessages.length, 0, "投递未完成前不得有结果回复");

    gate.resolve();
    await waitForCondition(
      () => harness.sendAttachmentCalls.length >= 1,
      2000,
      "投递在 deferred resolve 后完成",
    );
    await waitForCondition(() => harness.sentMessages.length >= 1, 2000, "fileSent 结果回复到达");
    assert.equal(harness.sentMessages[0].text, "已发送 result.txt（11B）。");
  } finally {
    await harness.dispose();
  }
});

test("A3a 后台失败：not-found 结果经 sendOutbound 回复本地化文案，无 unhandled rejection", async () => {
  const harness = await createHarness();
  const rejections: unknown[] = [];
  const onUnhandled = (error: unknown) => {
    rejections.push(error);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    const ackReplies = await withTimeout(
      harness.service.handleInboundMessage({
        botId: WEIXIN_BOT_ID,
        actor: {
          provider: "weixin",
          botId: WEIXIN_BOT_ID,
          providerUserId: "wx-user-1",
          chatType: "private",
          chatId: "wx-chat-1",
          providerMessageId: "msg-file-missing",
        },
        text: "/file missing.bin",
        receivedAt: Date.now(),
      }),
      1000,
      "/file ack 必须立即返回",
    );
    assert.equal(ackReplies.length, 1);
    assert.equal(ackReplies[0].text, FILE_FETCH_STARTED_ZH);
    await waitForCondition(() => harness.sentMessages.length >= 1, 2000, "后台失败回复必须到达");
    assert.equal(harness.sentMessages[0].text, "文件不存在或不可读：missing.bin");
    assert.equal(harness.sendAttachmentCalls.length, 0);
    // 后台腿的任何异常都不得泄漏为 unhandled rejection。
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(rejections, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await harness.dispose();
  }
});
