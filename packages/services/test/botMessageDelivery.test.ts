import assert from "node:assert/strict";
import test from "node:test";
import type { IDisposable } from "@zcode/rpc";
import {
  ZCODE_AGENT_PROVIDER,
  type BotActor,
  type BotConfig,
  type BotOutboundMessage,
} from "@zcode/shared";
import { BOTS_CONFIG_FILE, BOTS_STATE_FILE } from "../src/bots/config.js";
import { createBotsService } from "../src/bots/botsService.js";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";
import type { IBotsService } from "../src/bots/bots.js";
import type { IZCodeTaskService } from "../src/session/zcodeTaskService.js";
import type { ICredentialService } from "../src/credential/credential.js";
import type { IModelSelectionService } from "../src/model-provider/providerFacadeServices.js";
import type {
  BotProviderAdapter,
  BotStreamingReplyCardHandle,
  BotStreamingReplyCardState,
} from "../src/bots/providers/types.js";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// specs/bot-message-delivery.md（3.14.5 Alpha 1）验收场景：
// F1 单一 drain owner（/stop 部分回复立即送达 + 订阅拆除 + 下轮 fresh watcher +
// 跨聊天 stale closure 回归）；F2 有损有界 flush（trim-on-success + 预算耗尽丢弃 +
// 一次性通知 + 毒丸不阻塞队列）；F3 交互边界 flush；F4 微信文本发送前读取最新
// 持久化 context token（provider 级 ret=-2 无 token 重试与显式超时在
// botMessageDeliveryProviders.test.ts）；F5 飞书熔断复位 + 终态 half-open 渲染 +
// 文本降级；F7 终态正文先于快照文书。

const WEIXIN_BOT_ID = "bot-wx";
const FEISHU_BOT_ID = "bot-feishu";
const CONVERSATIONAL_TASK_ID = "task-conv-1";
/** messages.ts replyDeliveryFailed（zh）——F2 丢弃通知文案的钉住值。 */
const REPLY_DELIVERY_FAILED_ZH = "部分回复未能送达，已跳过。";
const TASK_COMPLETED_ZH = "任务已完成。";

type StreamEnqueue = (event: unknown) => Promise<void>;

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

interface CardCall {
  op: "create" | "update";
  status: BotStreamingReplyCardState["status"];
}

interface HarnessOptions {
  provider?: "weixin" | "feishu";
}

interface Harness {
  service: IBotsService & { disposeAllAndWait(): Promise<void> };
  sentMessages: BotOutboundMessage[];
  typingCalls: { op: "start" | "stop"; targetId: string }[];
  cardCalls: CardCall[];
  cardControl: { failNext: number };
  sendControl: { failTextPattern: RegExp | undefined };
  stopGenerationCalls: string[];
  snapshotControl: {
    status: "running" | "completed" | "error" | null;
    hangDeferred: Deferred | undefined;
  };
  /** 直接改写落盘的微信持久化 token 表（模拟任务中途的入站 ping 刷新）。 */
  overwritePersistedWeixinToken(token: string): Promise<void>;
  getStreamEnqueue: () => StreamEnqueue | undefined;
  triggerMessage(options?: {
    text?: string;
    providerUserId?: string;
    chatId?: string;
    providerContextToken?: string;
    messageId?: string;
  }): Promise<BotOutboundMessage[]>;
  dispose(): Promise<void>;
}

let inboundMessageCounter = 0;

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const provider = options.provider ?? "weixin";
  const dataRoot = await mkdtemp(join(tmpdir(), "zcode-bot-delivery-"));
  setDataBaseDir(dataRoot);
  const workspace = await mkdtemp(join(tmpdir(), "zcode-bot-delivery-ws-"));
  const configDir = getAppConfigDir();
  await mkdir(configDir, { recursive: true });
  const botConfig: BotConfig =
    provider === "feishu"
      ? {
          id: FEISHU_BOT_ID,
          name: "Feishu Bot",
          provider: "feishu",
          enabled: true,
          feishuAppId: "cli_test_feishu",
          credentialRef: "feishu-secret",
          // 非 weixin provider 的 findAuthorizedBot 按 providerUserId 匹配。
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
          replyMode: "streaming_card",
        }
      : {
          id: WEIXIN_BOT_ID,
          name: "WeChat Bot",
          provider: "weixin",
          enabled: true,
          providerUserId: "wx-bot-self",
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
        };
  await writeFile(
    join(configDir, BOTS_CONFIG_FILE),
    JSON.stringify({ version: 3, bots: [botConfig] }),
  );
  await writeFile(
    join(configDir, BOTS_STATE_FILE),
    JSON.stringify({
      version: 3,
      bots: {
        [botConfig.id]: {
          botId: botConfig.id,
          workspacePath: workspace,
          mode: "task",
          activeTaskId: CONVERSATIONAL_TASK_ID,
          weixinActivatedAt: 1,
          updatedAt: 1,
        },
      },
    }),
  );

  const sentMessages: BotOutboundMessage[] = [];
  const typingCalls: Array<{ op: "start" | "stop"; targetId: string }> = [];
  const cardCalls: CardCall[] = [];
  const cardControl = { failNext: 0 };
  const sendControl: { failTextPattern: RegExp | undefined } = { failTextPattern: undefined };
  const stopGenerationCalls: string[] = [];
  const snapshotControl: {
    status: "running" | "completed" | "error" | null;
    hangDeferred: Deferred | undefined;
  } = { status: null, hangDeferred: undefined };

  let cardHandleCounter = 0;
  const adapter: BotProviderAdapter = {
    test: async () => ({ ok: true, message: "stub" }),
    send: async (_bot, message) => {
      if (sendControl.failTextPattern?.test(message.text)) {
        throw new Error("provider send rejected (test)");
      }
      sentMessages.push(message);
    },
    startTyping: async (_bot, target) => {
      typingCalls.push({ op: "start", targetId: target.providerUserId });
    },
    stopTyping: async (_bot, target) => {
      typingCalls.push({ op: "stop", targetId: target.providerUserId });
    },
    ...(provider === "feishu"
      ? {
          createStreamingReplyCard: async (
            _bot: BotConfig,
            state: BotStreamingReplyCardState,
          ): Promise<BotStreamingReplyCardHandle | null> => {
            cardCalls.push({ op: "create", status: state.status });
            if (cardControl.failNext > 0) {
              cardControl.failNext -= 1;
              throw new Error("feishu card create failed (test)");
            }
            cardHandleCounter += 1;
            return { providerMessageId: `om-card-${cardHandleCounter}` };
          },
          updateStreamingReplyCard: async (
            _bot: BotConfig,
            handle: BotStreamingReplyCardHandle,
            state: BotStreamingReplyCardState,
          ): Promise<void> => {
            cardCalls.push({ op: "update", status: state.status });
            if (cardControl.failNext > 0) {
              cardControl.failNext -= 1;
              throw new Error("feishu card update failed (test)");
            }
          },
        }
      : {}),
  };

  let streamEnqueue: StreamEnqueue | undefined;
  const fakeTaskService = {
    listDeletedTaskIds: async () => [] as string[],
    resumeTask: async () => undefined,
    createTask: async () => ({ taskId: "task-created" }),
    deleteTask: async () => undefined,
    stopGeneration: async (request: { taskId: string }) => {
      stopGenerationCalls.push(request.taskId);
    },
    getTaskModelSelection: async () => ({
      providerId: ZCODE_AGENT_PROVIDER,
      modelId: "glm-test",
    }),
    getTaskConfigOptions: async () => [],
    listTasks: async () => [],
    getTaskSnapshot: async () => {
      if (snapshotControl.hangDeferred) {
        await snapshotControl.hangDeferred.promise;
      }
      return snapshotControl.status
        ? {
            meta: {
              taskId: CONVERSATIONAL_TASK_ID,
              status: snapshotControl.status,
              title: "terminal task",
            },
          }
        : null;
    },
    sendPrompt: async () => undefined,
    setMode: async () => undefined,
    onDynamicStreamEvent:
      (taskId: string) =>
      (enqueue: StreamEnqueue): IDisposable => {
        assert.ok(
          taskId === CONVERSATIONAL_TASK_ID || taskId === "task-created",
          `unexpected stream taskId: ${taskId}`,
        );
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
    providerOverrides: { [provider]: adapter },
  });

  const buildInbound = (overrides: {
    text?: string;
    providerUserId?: string;
    chatId?: string;
    providerContextToken?: string;
  }) => {
    inboundMessageCounter += 1;
    const actor: BotActor = {
      provider,
      botId: botConfig.id,
      providerUserId: overrides.providerUserId ?? "wx-user-1",
      chatType: "private",
      chatId: overrides.chatId ?? "wx-chat-1",
      providerMessageId: `msg-${inboundMessageCounter}`,
      ...(overrides.providerContextToken
        ? { providerContextToken: overrides.providerContextToken }
        : {}),
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
    sentMessages,
    typingCalls,
    cardCalls,
    cardControl,
    sendControl,
    stopGenerationCalls,
    snapshotControl,
    async overwritePersistedWeixinToken(token: string) {
      const statePath = join(configDir, BOTS_STATE_FILE);
      const state = JSON.parse(await readFile(statePath, "utf8")) as {
        bots: Record<
          string,
          { weixinContextTokens?: Record<string, { token: string; updatedAt: number }> }
        >;
      };
      const entry = state.bots[botConfig.id]!;
      entry.weixinContextTokens = {
        ...entry.weixinContextTokens,
        "wx-chat-1": { token, updatedAt: Date.now() },
      };
      await writeFile(statePath, JSON.stringify(state));
    },
    getStreamEnqueue: () => streamEnqueue,
    async triggerMessage(overrides = {}) {
      const replies = await service.handleInboundMessage(buildInbound(overrides));
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

function chunkEvent(content: string): unknown {
  return {
    type: "agent_message_chunk",
    taskId: CONVERSATIONAL_TASK_ID,
    traceId: "trace-1",
    content,
  };
}

function toolCallEvent(toolId: string): unknown {
  return {
    type: "tool_call",
    taskId: CONVERSATIONAL_TASK_ID,
    traceId: "trace-1",
    toolId,
    input: {},
    kind: "bash",
    title: `tool ${toolId}`,
    raw: {},
  };
}

function permissionRequestEvent(): unknown {
  return {
    type: "permission_request",
    taskId: CONVERSATIONAL_TASK_ID,
    traceId: "trace-1",
    requestId: "req-perm-1",
    description: "run a command",
    kind: "execute",
    options: [
      {
        optionId: "option-allow",
        kind: "allow",
        name: "Allow",
        response: { decision: "allow" },
      },
      {
        optionId: "option-deny",
        kind: "deny",
        name: "Deny",
        response: { decision: "deny" },
      },
    ],
    raw: {},
  };
}

function taskCompleteEvent(): unknown {
  return {
    type: "task_complete",
    taskId: CONVERSATIONAL_TASK_ID,
    traceId: "trace-1",
    stopReason: "end_turn",
  };
}

function taskErrorEvent(error: string): unknown {
  return {
    type: "task_error",
    taskId: CONVERSATIONAL_TASK_ID,
    traceId: "trace-1",
    error,
  };
}

async function requireEnqueue(harness: Harness): Promise<StreamEnqueue> {
  await waitForCondition(() => harness.getStreamEnqueue() !== undefined, 1000, "stream 订阅建立");
  const enqueue = harness.getStreamEnqueue();
  assert.ok(enqueue, "stream enqueue 必须存在");
  return enqueue;
}

// ---- F1：/stop drain（stale-watcher orphan 复现） ----

test("F1 /stop：部分回复立即作为独立消息送达，typing 清理，订阅拆除，下一条消息建立新 watcher 且不粘连", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    await enqueue(chunkEvent("部分回复A"));
    assert.equal(harness.sentMessages.length, 0, "非终态 chunk 不得提前发送（留缓冲）");

    const stopReplies = await harness.triggerMessage({ text: "/stop" });
    assert.ok(stopReplies.length > 0, "/stop 必须有状态回复");
    // 修复前：/stop 不 flush 缓冲——部分回复被扣住，直到下一条消息把新旧正文粘成一条。
    assert.ok(
      harness.sentMessages.some((message) => message.text.includes("部分回复A")),
      "/stop 必须把未送出的部分回复作为独立消息送达",
    );
    // typing 已清理（stop 调用到达 adapter）。
    assert.ok(
      harness.typingCalls.some((call) => call.op === "stop"),
      "/stop 后 typing 必须停止",
    );
    // 订阅已拆除：fake 的 dispose 会清空 enqueue。
    assert.equal(harness.getStreamEnqueue(), undefined, "/stop 后订阅必须拆除");

    // 下一轮：fresh watcher，新正文独立成条，不与旧缓冲粘连。
    await harness.triggerMessage({ text: "新任务输入" });
    const nextEnqueue = await requireEnqueue(harness);
    assert.notEqual(nextEnqueue, enqueue, "watchTaskStream 必须创建全新 watcher");
    await nextEnqueue(chunkEvent("新回合正文"));
    await nextEnqueue(toolCallEvent("tool-2"));
    const glued = harness.sentMessages.find((message) => message.text.includes("部分回复A"));
    assert.ok(
      glued && glued.text.trim() === "部分回复A",
      `新回合正文不得与旧缓冲粘连：${JSON.stringify(harness.sentMessages.map((m) => m.text))}`,
    );
    assert.ok(
      harness.sentMessages.some((message) => message.text === "新回合正文"),
      "新回合正文必须独立送达",
    );
  } finally {
    await harness.dispose();
  }
});

// ---- F2：trim-on-success + 预算耗尽丢弃 + 一次性通知 ----

test("F2 部分发送失败：成功分块保留，失败分块按预算（≤2 次尝试）丢弃并通知，不重复发送已成功分块", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    await enqueue(chunkEvent("第一段"));
    await enqueue(toolCallEvent("tool-1"));
    assert.deepEqual(
      harness.sentMessages.map((message) => message.text),
      ["第一段"],
    );

    harness.sendControl.failTextPattern = /毒丸/u;
    const startedAt = Date.now();
    await enqueue(chunkEvent("第二段毒丸"));
    await enqueue(toolCallEvent("tool-2"));
    const elapsedMs = Date.now() - startedAt;
    // 修复前：extract-before-send 清缓冲后发送失败被队列吞掉——第二段静默丢失且无通知。
    assert.ok(
      harness.sentMessages.some((message) => message.text === REPLY_DELIVERY_FAILED_ZH),
      "发送失败必须送达一次性本地化通知",
    );
    assert.ok(elapsedMs < 5000, `毒丸分块必须受预算约束（实测 ${elapsedMs}ms < 5s）`);

    // 通道恢复后：后续分块正常送达；已成功分块不被重发。
    harness.sendControl.failTextPattern = undefined;
    await enqueue(chunkEvent("第三段"));
    await enqueue(toolCallEvent("tool-3"));
    const firstCount = harness.sentMessages.filter((message) => message.text === "第一段").length;
    assert.equal(firstCount, 1, "已成功分块不得重复发送");
    assert.ok(
      harness.sentMessages.some((message) => message.text === "第三段"),
      "毒丸丢弃后队列继续工作",
    );
    assert.equal(
      harness.sentMessages.filter((message) => message.text === REPLY_DELIVERY_FAILED_ZH).length,
      1,
      "同一失败 flush 只通知一次",
    );
  } finally {
    await harness.dispose();
  }
});

test("F2 毒丸分块不得把后续事件拖延出预算（终态正文先于回执，队列继续）", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    harness.sendControl.failTextPattern = /poison/u;
    const startedAt = Date.now();
    await enqueue(chunkEvent("poison 正文"));
    await enqueue(taskCompleteEvent());
    await waitForCondition(
      () => harness.sentMessages.some((message) => message.text === REPLY_DELIVERY_FAILED_ZH),
      4500,
      "毒丸通知必须在预算内到达",
    );
    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs < 5000, `终态处理必须受预算约束（实测 ${elapsedMs}ms < 5s）`);
    // 通道仍拒毒丸但接受其它文本：任务完成回执照常送达（队列未被毒丸卡死）。
    harness.sendControl.failTextPattern = undefined;
    await waitForCondition(
      () => harness.sentMessages.some((message) => message.text === TASK_COMPLETED_ZH),
      3000,
      "任务完成回执必须送达",
    );
  } finally {
    await harness.dispose();
  }
});

// ---- F3：交互边界 flush ----

test("F3 permission_request：文本 provider 先把已缓冲正文作为独立消息送达，再发权限提示", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    await enqueue(chunkEvent("问题前正文"));
    await enqueue(permissionRequestEvent());
    // 修复前：permission 不 flush——问题前正文滞留缓冲，与回答后的正文粘连。
    assert.equal(harness.sentMessages[0]?.text, "问题前正文", "权限提示前必须先送达已缓冲正文");
    assert.ok(harness.sentMessages.length >= 2, "权限提示消息必须随后送达");
    assert.match(harness.sentMessages[1].text, /需要权限|run a command/u);
  } finally {
    await harness.dispose();
  }
});

// ---- F4：发送时读取最新持久化微信 token（服务层单一出口） ----

test("F4 微信流内文本发送读取最新持久化 context token（捕获 token 兜底）", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage({ providerContextToken: "token-stale" });
    const enqueue = await requireEnqueue(harness);
    // 任务中途发生新的入站 ping：持久化 token 表被刷新为 token-fresh，
    // watcher 闭包里捕获的仍是 token-stale。
    await harness.overwritePersistedWeixinToken("token-fresh");
    await enqueue(chunkEvent("正文"));
    await enqueue(toolCallEvent("tool-1"));
    const sent = harness.sentMessages.find((message) => message.text === "正文");
    assert.ok(sent, "正文必须送达");
    // 修复前：发送沿用 watcher 捕获的旧 token（>40min 长任务必然过期）。
    assert.equal(sent.providerContextToken, "token-fresh");
  } finally {
    await harness.dispose();
  }
});

// ---- F7：终态正文先于快照文书 ----

test("F7 终态正文先于 getTaskSnapshot：慢快照不得扣住完成正文", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    await enqueue(chunkEvent("完成正文B"));
    harness.snapshotControl.hangDeferred = createDeferred();
    const queueTail = enqueue(taskCompleteEvent());
    // 快照挂起期间正文必须先到（修复前 flush 在快照之后，正文被扣到快照返回）。
    await waitForCondition(
      () => harness.sentMessages.some((message) => message.text === "完成正文B"),
      2500,
      "完成正文必须在慢快照期间先送达",
    );
    harness.snapshotControl.hangDeferred.resolve();
    await queueTail.catch(() => undefined);
  } finally {
    if (harness.snapshotControl.hangDeferred) {
      harness.snapshotControl.hangDeferred.resolve();
    }
    await harness.dispose();
  }
});

// ---- F1：跨聊天 stale closure 回归 ----

test("F1 跨聊天 stale closure：终态丢失的旧 watcher 在新聊天续跑时拆除，回复路由到新聊天", async () => {
  const harness = await createHarness();
  try {
    // 聊天 A 续跑任务，watcher A 武装且缓冲持有未送正文。
    await harness.triggerMessage({ chatId: "chat-A", providerUserId: "user-A" });
    const enqueueA = await requireEnqueue(harness);
    await enqueueA(chunkEvent("旧正文"));
    // 任务实际已完成（终态事件丢失）：持久化状态翻到 completed。
    harness.snapshotControl.status = "completed";
    // 聊天 B 续跑同一任务。
    await harness.triggerMessage({
      chatId: "chat-B",
      providerUserId: "user-B",
      text: "换个聊天继续",
    });
    const enqueueB = await requireEnqueue(harness);
    assert.notEqual(enqueueB, enqueueA, "聊天 B 必须获得全新 watcher");
    await enqueueB(chunkEvent("新正文"));
    await enqueueB(taskCompleteEvent());
    // 修复前：watcher A 被静默复用——B 的正文粘着 A 的旧缓冲发到聊天 A。
    const delivered = harness.sentMessages.find((message) => message.text.includes("新正文"));
    assert.ok(delivered, "新正文必须送达");
    assert.equal(delivered.providerUserId, "chat-B", "新正文必须路由到聊天 B");
    const glued = harness.sentMessages.find((message) => message.text.includes("旧正文"));
    assert.ok(
      glued && glued.text.trim() === "旧正文",
      `旧缓冲必须在 stale 清理时独立送达聊天 A，不得粘连：${JSON.stringify(harness.sentMessages.map((m) => [m.providerUserId, m.text]))}`,
    );
  } finally {
    await harness.dispose();
  }
});

// ---- F5：飞书熔断复位 + 终态 half-open 渲染 ----

/** 连续失败 3 次触发熔断（backoff 1s/2s 需真实等待；force 触发用 tool_call 事件）。 */
async function openCircuit(harness: Harness, enqueue: StreamEnqueue): Promise<void> {
  harness.cardControl.failNext = 3;
  await enqueue(chunkEvent("卡片正文1"));
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  await enqueue(toolCallEvent("tool-card-1"));
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  await enqueue(toolCallEvent("tool-card-2"));
  const realAttempts = harness.cardCalls.length;
  assert.ok(realAttempts >= 3, `熔断前置失败必须真实发生（attempts=${realAttempts}）`);
}

test("F5 飞书终态 half-open 渲染：熔断打开后 task_complete 仍尝试一次并成功渲染 completed", async () => {
  const harness = await createHarness({ provider: "feishu" });
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    await openCircuit(harness, enqueue);
    const attemptsBeforeTerminal = harness.cardCalls.length;
    // 熔断打开：普通触发不再尝试。
    await enqueue(toolCallEvent("tool-card-3"));
    assert.equal(harness.cardCalls.length, attemptsBeforeTerminal, "熔断打开时普通触发必须跳过");
    // 终态 half-open：必尝试一次并成功（成功后熔断复位由下一次行为隐式保证）。
    await enqueue(taskCompleteEvent());
    const finalCall = harness.cardCalls.at(-1);
    assert.ok(finalCall, "终态渲染必须真实尝试（half-open）");
    assert.equal(finalCall.status, "completed", "终态卡片必须渲染 completed 状态");
    assert.ok(
      !harness.sentMessages.some((message) => message.text === TASK_COMPLETED_ZH),
      "卡片渲染成功时不得退化为文本完成消息",
    );
  } finally {
    await harness.dispose();
  }
});

test("F5 飞书终态渲染失败：诚实降级为标准文本完成消息", async () => {
  const harness = await createHarness({ provider: "feishu" });
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    await openCircuit(harness, enqueue);
    // 终态 half-open 尝试仍失败：降级为文本完成消息。
    harness.cardControl.failNext = 1;
    await enqueue(taskCompleteEvent());
    assert.ok(
      harness.sentMessages.some((message) => message.text === TASK_COMPLETED_ZH),
      "终态渲染失败必须降级为文本完成消息",
    );
    const finalCall = harness.cardCalls.at(-1);
    assert.ok(finalCall, "降级前必须真实尝试过终态渲染");
  } finally {
    await harness.dispose();
  }
});

test("F5 飞书错误终态同样 half-open + 文本降级：熔断打开时 task_error 不冻结、错误必达", async () => {
  const harness = await createHarness({ provider: "feishu" });
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    await openCircuit(harness, enqueue);
    // 错误终态 half-open 尝试仍失败：降级为本地化 taskFailed 文本通知。
    harness.cardControl.failNext = 1;
    await enqueue(taskErrorEvent("boom"));
    const finalCall = harness.cardCalls.at(-1);
    assert.ok(finalCall, "错误终态必须真实尝试 half-open 渲染");
    assert.equal(finalCall.status, "error", "错误终态卡片状态必须为 error");
    const degradeText = harness.sentMessages.find((message) => message.text.includes("boom"));
    assert.ok(degradeText, "错误终态渲染失败必须降级为包含错误信息的文本通知");
  } finally {
    await harness.dispose();
  }
});

test("F2 单次多分块 flush：兄弟分块已送达则不丢弃，失败分块按预算丢弃并通知", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    // >3500 字符强制 splitLongReplyText 切成 2 个分块；失败模式只命中第二个分块。
    harness.sendControl.failTextPattern = /毒丸尾部/u;
    await enqueue(chunkEvent(`${"A".repeat(3500)}毒丸尾部`));
    await enqueue(toolCallEvent("tool-multi"));
    const deliveredSibling = harness.sentMessages.find((message) =>
      message.text.startsWith("A".repeat(10)),
    );
    assert.ok(deliveredSibling, "同一次 flush 中先成功的兄弟分块必须送达");
    assert.equal(
      harness.sentMessages.filter((message) => message.text === deliveredSibling?.text).length,
      1,
      "已成功分块不得重复发送",
    );
    assert.ok(
      harness.sentMessages.some((message) => message.text === REPLY_DELIVERY_FAILED_ZH),
      "失败分块耗尽预算必须送达一次性通知",
    );
    // 通道恢复后队列继续。
    harness.sendControl.failTextPattern = undefined;
    await enqueue(chunkEvent("后续正文"));
    await enqueue(toolCallEvent("tool-after"));
    assert.ok(
      harness.sentMessages.some((message) => message.text === "后续正文"),
      "丢弃后队列必须继续工作",
    );
  } finally {
    await harness.dispose();
  }
});
