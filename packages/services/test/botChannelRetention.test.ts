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
import type { BotProviderAdapter } from "../src/bots/providers/types.js";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// specs/bot-message-delivery.md（3.14.5-alpha.4）"Retention buffer（channel-dead 保留缓冲）"：
// M1 sendOutbound 缝隙三分类保留 + revival（任意 weixin 入站，非 token 值变化）+
// /status 待补发行 + M5 writeContext 陈旧上下文写回保全。
// 场景 1/2/3/4/6/8/10/12（red-first；场景 5 分类钉住 + 场景 11 健康路径回归
// 由本文件 content-poison 用例与 botMessageDelivery.test.ts 既有用例共同看守）。

const WEIXIN_BOT_ID = "bot-wx-retention";
const CONVERSATIONAL_TASK_ID = "task-retain-1";
/** messages.ts replyDeliveryFailed（zh）——content-poison 丢弃通知文案的钉住值。 */
const REPLY_DELIVERY_FAILED_ZH = "部分回复未能送达，已跳过。";
const TASK_COMPLETED_ZH = "任务已完成。";
const HEAD_TRUNCATED_ZH = "…(更早的积压消息已截断)";
/** revival 序言（zh，owner 决定 §7.20 文案）：断线期间积压的 N 条消息已补发。 */
function preambleWithCount(count: number): string {
  return `断线期间积压的 ${count} 条消息已补发`;
}

// ---- 判别源构造（F2.3 修订：channel-dead / content-poison 必须在测试中可构造） ----

/** channel-dead：打标 weixinRet=-2（会话死与瞬态 -2 客户端不可分，一律按死通道保留）。 */
function channelDeadWeixinRetError(): Error {
  const error = new Error("Weixin iLink /sendmessage failed: ret=-2");
  (error as Error & { weixinRet?: number }).weixinRet = -2;
  return error;
}

/** channel-dead：网络类——providerRequest 15s deadline 的超时错误文本形状。 */
function channelDeadTimeoutError(): Error {
  return new Error("Bot provider request timed out after 15000ms.");
}

/** channel-dead：网络类——AbortError 错误名（外部 signal 中止）。 */
function channelDeadAbortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

/** channel-dead：网络类——HTTP 5xx（weixinHttpStatus 打标 + 文本双形状）。 */
function channelDeadHttp5xxError(): Error {
  const error = new Error("Weixin iLink /sendmessage failed: HTTP 502");
  (error as Error & { weixinHttpStatus?: number }).weixinHttpStatus = 502;
  return error;
}

/** content-poison：非 -2 的协议错误（如业务拒绝形状）。 */
function contentPoisonWeixinRetError(): Error {
  const error = new Error("Weixin iLink /sendmessage failed: ret=1");
  (error as Error & { weixinRet?: number }).weixinRet = 1;
  return error;
}

// ---- harness ----

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(
  condition: () => boolean,
  timeoutMs = 3000,
  label = "condition",
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      assert.fail(`等待超时：${label}`);
    }
    await sleep(10);
  }
  return true;
}

interface SendControl {
  failPattern: RegExp | undefined;
  errorFactory: (() => Error) | undefined;
  /** 命中时 send 在 gate promise 上挂起（并发交错的确定性控制）。 */
  gate: ((text: string) => Promise<void> | undefined) | undefined;
}

interface Harness {
  service: IBotsService & { disposeAllAndWait(): Promise<void> };
  sentMessages: BotOutboundMessage[];
  sendAttempts: string[];
  sendControl: SendControl;
  snapshotControl: {
    status: "running" | "completed" | "error" | null;
    hangDeferred: Deferred | undefined;
  };
  stopGenerationCalls: string[];
  createTaskCalls: string[];
  sendPromptCalls: string[];
  overwritePersistedBotEntry(patch: Record<string, unknown>): Promise<void>;
  readStateBotEntry(): Promise<Record<string, unknown>>;
  getStreamEnqueue(): StreamEnqueue | undefined;
  triggerMessage(options?: {
    text?: string;
    providerUserId?: string;
    chatId?: string;
    providerContextToken?: string;
  }): Promise<BotOutboundMessage[]>;
  dispose(): Promise<void>;
}

let inboundMessageCounter = 0;

async function createHarness(): Promise<Harness> {
  const dataRoot = await mkdtemp(join(tmpdir(), "zcode-bot-retention-"));
  setDataBaseDir(dataRoot);
  const workspace = await mkdtemp(join(tmpdir(), "zcode-bot-retention-ws-"));
  const configDir = getAppConfigDir();
  await mkdir(configDir, { recursive: true });
  const botConfig: BotConfig = {
    id: WEIXIN_BOT_ID,
    name: "WeChat Retention Bot",
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
  const sendAttempts: string[] = [];
  const sendControl: SendControl = {
    failPattern: undefined,
    errorFactory: undefined,
    gate: undefined,
  };
  const snapshotControl: {
    status: "running" | "completed" | "error" | null;
    hangDeferred: Deferred | undefined;
  } = { status: null, hangDeferred: undefined };
  const stopGenerationCalls: string[] = [];
  const createTaskCalls: string[] = [];
  const sendPromptCalls: string[] = [];

  let streamEnqueue: StreamEnqueue | undefined;
  let taskCounter = 0;
  const fakeTaskService = {
    listDeletedTaskIds: async () => [] as string[],
    resumeTask: async () => undefined,
    createTask: async () => {
      taskCounter += 1;
      const taskId = `task-created-${taskCounter}`;
      createTaskCalls.push(taskId);
      return { taskId };
    },
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
    sendPrompt: async (request: { taskId: string }) => {
      sendPromptCalls.push(request.taskId);
    },
    setMode: async () => undefined,
    onDynamicStreamEvent:
      (taskId: string) =>
      (enqueue: StreamEnqueue): IDisposable => {
        assert.ok(
          taskId === CONVERSATIONAL_TASK_ID || taskId.startsWith("task-created-"),
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

  const adapter: BotProviderAdapter = {
    test: async () => ({ ok: true, message: "stub" }),
    send: async (_bot, message) => {
      sendAttempts.push(message.text);
      const gatePromise = sendControl.gate?.(message.text);
      if (gatePromise) {
        await gatePromise;
      }
      if (sendControl.failPattern?.test(message.text)) {
        throw sendControl.errorFactory
          ? sendControl.errorFactory()
          : new Error("provider send rejected (test)");
      }
      sentMessages.push(message);
    },
  };

  const service = createBotsService({
    credentialService,
    zcodeTaskService: fakeTaskService as unknown as IZCodeTaskService,
    modelSelectionService,
    runStartupBackgroundTasks: false,
    providerOverrides: { weixin: adapter },
  });

  const buildInbound = (overrides: {
    text?: string;
    providerUserId?: string;
    chatId?: string;
    providerContextToken?: string;
  }) => {
    inboundMessageCounter += 1;
    const actor: BotActor = {
      provider: "weixin",
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
    sendAttempts,
    sendControl,
    snapshotControl,
    stopGenerationCalls,
    createTaskCalls,
    sendPromptCalls,
    async overwritePersistedBotEntry(patch: Record<string, unknown>) {
      const statePath = join(configDir, BOTS_STATE_FILE);
      const state = JSON.parse(await readFile(statePath, "utf8")) as {
        bots: Record<string, Record<string, unknown>>;
      };
      state.bots[botConfig.id] = { ...state.bots[botConfig.id], ...patch };
      await writeFile(statePath, JSON.stringify(state));
    },
    async readStateBotEntry() {
      const state = JSON.parse(await readFile(join(configDir, BOTS_STATE_FILE), "utf8")) as {
        bots: Record<string, Record<string, unknown>>;
      };
      return state.bots[botConfig.id] ?? {};
    },
    getStreamEnqueue: () => streamEnqueue,
    async triggerMessage(overrides = {}) {
      const replies = await service.handleInboundMessage(buildInbound(overrides));
      await sleep(25);
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

// ---- 事件构造（与 botMessageDelivery.test.ts 同构） ----

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

function elicitationRequestEvent(requestId: string): unknown {
  return {
    type: "elicitation_request",
    taskId: CONVERSATIONAL_TASK_ID,
    traceId: "trace-el-1",
    requestId,
    message: "选颜色？",
    options: [
      { value: "red", label: "红" },
      { value: "blue", label: "蓝" },
    ],
  };
}

function elicitationResponseEvent(requestId: string): unknown {
  return {
    type: "elicitation_response",
    taskId: CONVERSATIONAL_TASK_ID,
    traceId: "trace-el-1",
    requestId,
  };
}

async function requireEnqueue(harness: Harness): Promise<StreamEnqueue> {
  await waitForCondition(() => harness.getStreamEnqueue() !== undefined, 1000, "stream 订阅建立");
  const enqueue = harness.getStreamEnqueue();
  assert.ok(enqueue, "stream enqueue 必须存在");
  return enqueue;
}

// ---- 场景 1：channel-dead ⇒ 保留（不丢弃、无通知尝试）+ revival 补发 ----

test("场景1 channel-dead（weixinRet=-2 标签）flush 失败：恰一次尝试即保留，无丢弃通知尝试，revival 序言+补发", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    harness.sendControl.failPattern = /断线正文/u;
    harness.sendControl.errorFactory = channelDeadWeixinRetError;
    await enqueue(chunkEvent("断线正文"));
    await enqueue(toolCallEvent("tool-r1"));
    // 死通道：首败即停（无第二次尝试）；通知不可能送达（§8.7）——零通知尝试。
    assert.equal(
      harness.sendAttempts.filter((text) => text === "断线正文").length,
      1,
      "channel-dead 首败即停：恰一次尝试",
    );
    assert.equal(
      harness.sendAttempts.includes(REPLY_DELIVERY_FAILED_ZH),
      false,
      "死通道上不得尝试发送丢弃通知",
    );
    assert.equal(harness.sentMessages.length, 0, "死通道上没有任何成功发送");
    // 通道恢复 + 任意入站 ⇒ revival：一条序言先行，再按序补发积压。
    harness.sendControl.failPattern = undefined;
    harness.sendControl.errorFactory = undefined;
    await harness.triggerMessage({ text: "ping" });
    assert.deepEqual(
      harness.sentMessages.map((message) => message.text),
      [preambleWithCount(1), "断线正文"],
      "revival 必须先发一条序言再按序补发积压",
    );
  } finally {
    await harness.dispose();
  }
});

test("场景1 终态 drain 保留最终报告（16:42 丢失类）：全链路死通道 ⇒ 报告+完成回执保留，watcher dispose 后存活并 revival 补发", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    harness.sendControl.failPattern = /.*/u;
    harness.sendControl.errorFactory = channelDeadWeixinRetError;
    await enqueue(chunkEvent("最终报告正文"));
    await enqueue(taskCompleteEvent());
    // 死通道：无成功发送、无丢弃通知；正文（drain flush + 终态 force 边界各一次有界尝试）
    // 与完成回执（fallback 直发）全部进入保留缓冲。
    assert.equal(harness.sentMessages.length, 0, "死通道上没有任何成功发送");
    assert.equal(
      harness.sendAttempts.includes(REPLY_DELIVERY_FAILED_ZH),
      false,
      "死通道上不得尝试发送丢弃通知",
    );
    assert.ok(
      harness.sendAttempts.includes("最终报告正文"),
      "drain flush 必须真实尝试发送最终报告",
    );
    assert.ok(
      harness.sendAttempts.includes(TASK_COMPLETED_ZH),
      "完成回执 fallback 必须真实尝试直发",
    );
    // watcher 已拆除（订阅 dispose），积压仍存活（service-owned，不由 watcher 持有）。
    assert.equal(harness.getStreamEnqueue(), undefined, "终态后 watcher 必须拆除");
    harness.sendControl.failPattern = undefined;
    harness.sendControl.errorFactory = undefined;
    await harness.triggerMessage({ text: "ping" });
    assert.deepEqual(
      harness.sentMessages.map((message) => message.text),
      [preambleWithCount(2), "最终报告正文", TASK_COMPLETED_ZH],
      "revival 必须按序补发报告正文与完成回执",
    );
  } finally {
    await harness.dispose();
  }
});

// ---- 场景 3：终态文书直发失败（sendOutbound 直发路径，非 flush 循环） ----

test("场景3 终态文书直发失败（task_error 纯文本路径）⇒ 缝隙保留，直发路径无预算重试", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    harness.sendControl.failPattern = /.*/u;
    harness.sendControl.errorFactory = channelDeadWeixinRetError;
    // 缓冲为空：task_error 走 :5451 直发（不经 flush 循环）。
    await enqueue(taskErrorEvent("boom"));
    const taskFailedText = harness.sendAttempts.find((text) => text.includes("boom"));
    assert.ok(taskFailedText, "task_error 文书必须真实尝试直发");
    assert.equal(
      harness.sendAttempts.filter((text) => text === taskFailedText).length,
      1,
      "直发路径失败不进入 flush 预算重试",
    );
    assert.equal(harness.sentMessages.length, 0, "死通道上没有任何成功发送");
    harness.sendControl.failPattern = undefined;
    harness.sendControl.errorFactory = undefined;
    await harness.triggerMessage({ text: "ping" });
    assert.deepEqual(
      harness.sentMessages.map((message) => message.text),
      [preambleWithCount(1), taskFailedText],
      "直发失败的终态文书必须在 revival 补发",
    );
  } finally {
    await harness.dispose();
  }
});

// ---- 场景 4：瞬态网络类 ⇒ 保留 + 下一 force 边界有界重试，无丢弃 ----

test("场景4 瞬态网络类（超时文本/AbortError 名/HTTP 5xx 三判别源）⇒ 保留并在下一 force 边界补发成功，无丢弃", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    const cycles: Array<{ factory: () => Error; text: string; after: string }> = [
      { factory: channelDeadTimeoutError, text: "超时形状正文", after: "超时后正文" },
      { factory: channelDeadAbortError, text: "中止形状正文", after: "中止后正文" },
      { factory: channelDeadHttp5xxError, text: "五佰形状正文", after: "五佰后正文" },
    ];
    let toolCounter = 0;
    for (const cycle of cycles) {
      toolCounter += 1;
      harness.sendControl.failPattern = new RegExp(cycle.text, "u");
      harness.sendControl.errorFactory = cycle.factory;
      await enqueue(chunkEvent(cycle.text));
      await enqueue(toolCallEvent(`tool-net-${toolCounter}`));
      assert.equal(
        harness.sendAttempts.filter((text) => text === cycle.text).length,
        1,
        `${cycle.text}：网络类首败即停（无第二次尝试）`,
      );
      // 通道恢复：下一个 force 边界先补发积压（更旧→先发），再 flush 当前缓冲；无序言（非 revival）。
      harness.sendControl.failPattern = undefined;
      harness.sendControl.errorFactory = undefined;
      await enqueue(chunkEvent(cycle.after));
      await enqueue(toolCallEvent(`tool-net-after-${toolCounter}`));
      const deliveredTexts = harness.sentMessages.map((message) => message.text);
      assert.ok(deliveredTexts.includes(cycle.text), `${cycle.text}：必须在下一 force 边界补发`);
      assert.ok(
        deliveredTexts.indexOf(cycle.text) < deliveredTexts.indexOf(cycle.after),
        `${cycle.text}：积压必须先于当前缓冲正文`,
      );
      assert.equal(
        harness.sentMessages.filter((message) => message.text === cycle.text).length,
        1,
        `${cycle.text}：补发恰一次`,
      );
    }
    assert.equal(
      harness.sendAttempts.includes(REPLY_DELIVERY_FAILED_ZH),
      false,
      "网络类失败不得触发丢弃通知",
    );
  } finally {
    await harness.dispose();
  }
});

// ---- 场景 5 分类钉住：content-poison ⇒ alpha.1 语义不变 ----

test("场景5钉住 content-poison（weixinRet=1 标签）⇒ 两次尝试后丢弃 + 一次性通知，不进入保留缓冲", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    harness.sendControl.failPattern = /毒丸正文/u;
    harness.sendControl.errorFactory = contentPoisonWeixinRetError;
    await enqueue(chunkEvent("毒丸正文"));
    await enqueue(toolCallEvent("tool-poison"));
    assert.equal(
      harness.sendAttempts.filter((text) => text === "毒丸正文").length,
      2,
      "content-poison 维持 alpha.1 预算（≤2 次尝试）",
    );
    assert.equal(
      harness.sentMessages.filter((message) => message.text === REPLY_DELIVERY_FAILED_ZH).length,
      1,
      "content-poison 耗尽预算必须送达一次性通知",
    );
    // 未进入保留缓冲：后续任意入站无序言、无补发。
    await harness.triggerMessage({ text: "ping" });
    assert.equal(
      harness.sentMessages.some((message) => message.text.includes("已补发")),
      false,
      "content-poison 丢弃不得产生 revival 序言",
    );
  } finally {
    await harness.dispose();
  }
});

// ---- 场景 2：revival 触发 = 任意 weixin 入站（含 token 未轮换形态）+ 顺序 + 不复活 ping ----

test("场景2 revival 触发=任意 weixin 入站（token 未轮换形态仍触发）；积压先于新回合处理；不复活 ping 恰一次序言尝试后重新保留", async () => {
  const harness = await createHarness();
  try {
    // 建立持久化 token（token-a）——后续 revival 入站带同一 token（:1670 早退形态，pitfall 14）。
    await harness.triggerMessage({ providerContextToken: "token-a" });
    const enqueue = await requireEnqueue(harness);
    harness.sendControl.failPattern = /积压正文/u;
    harness.sendControl.errorFactory = channelDeadWeixinRetError;
    await enqueue(chunkEvent("积压正文"));
    await enqueue(toolCallEvent("tool-r2"));

    // 不复活的 ping：通道仍死（序言也失败）⇒ 恰一次序言尝试，积压原样保留（不重锤）。
    harness.sendControl.failPattern = /.*/u;
    const deadPingAttemptsBefore = harness.sendAttempts.length;
    await harness.triggerMessage({ providerContextToken: "token-a", text: "ping 死窗" });
    const deadPingAttempts = harness.sendAttempts.slice(deadPingAttemptsBefore);
    assert.equal(
      deadPingAttempts.filter((text) => text.includes("已补发")).length,
      1,
      "不复活 ping：序言恰一次有界尝试",
    );
    assert.equal(
      deadPingAttempts.includes("积压正文"),
      false,
      "不复活 ping：不得继续尝试积压正文（首块仍死即停止）",
    );

    // 复活 ping（token 仍未轮换——同一 token-a）：门控积压投递，验证积压先于新回合命令处理
    //（/stop 的 stopGeneration 是命令处理的确定性标记；普通文本会命中 taskRunning 早退分支）。
    harness.sendControl.failPattern = undefined;
    harness.sendControl.errorFactory = undefined;
    const gate = createDeferred();
    harness.sendControl.gate = (text) => (text === "积压正文" ? gate.promise : undefined);
    const markersBefore = harness.stopGenerationCalls.length;
    const revivalPromise = harness.triggerMessage({
      providerContextToken: "token-a",
      text: "/stop",
    });
    await waitForCondition(
      () => harness.sendAttempts.includes("积压正文"),
      2000,
      "revival 先发序言再补发积压",
    );
    assert.equal(
      harness.stopGenerationCalls.length,
      markersBefore,
      "积压补发进行中：新回合命令处理必须尚未开始",
    );
    gate.resolve();
    const stopReplies = await revivalPromise;
    assert.ok(stopReplies.length > 0, "/stop 必须有状态回复");
    assert.ok(harness.stopGenerationCalls.length > markersBefore, "积压补发完成后新回合才开始处理");
    assert.deepEqual(
      harness.sentMessages.map((message) => message.text),
      [preambleWithCount(1), "积压正文"],
      "revival：序言先行 + 未轮换 token 形态下积压仍补发",
    );
  } finally {
    await harness.dispose();
  }
});

// ---- 场景 6：/stop 死窗 + /status 待补发行 ----

test("场景6 /stop 死窗：部分回复保留而非立即送达；/stop 状态回复含待补发行；revival 补发", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    await enqueue(chunkEvent("部分回复A"));
    assert.equal(harness.sentMessages.length, 0, "非终态 chunk 不得提前发送");
    harness.sendControl.failPattern = /.*/u;
    harness.sendControl.errorFactory = channelDeadWeixinRetError;
    const stopReplies = await harness.triggerMessage({ text: "/stop" });
    // 死窗内 /stop：部分回复不再“立即送达”（死通道必然失败）——恰一次尝试后进入保留缓冲。
    assert.equal(
      harness.sendAttempts.filter((text) => text === "部分回复A").length,
      1,
      "drain flush 恰一次尝试",
    );
    assert.equal(harness.sentMessages.length, 0, "死通道上没有任何成功发送");
    assert.ok(harness.stopGenerationCalls.length > 0, "/stop 必须已停止生成");
    assert.equal(harness.getStreamEnqueue(), undefined, "/stop 后 watcher 必须拆除");
    // /stop 状态回复显示待补发行（count=1，约 KB）。
    const statusText = stopReplies.map((reply) => reply.text).join("\n");
    assert.match(
      statusText,
      /待补发：1 条断线积压消息（约 0\.0 KB）/u,
      "/status 回复必须包含待补发行",
    );
    // revival：序言 + 部分回复按序补发。
    harness.sendControl.failPattern = undefined;
    harness.sendControl.errorFactory = undefined;
    await harness.triggerMessage({ text: "ping" });
    assert.deepEqual(
      harness.sentMessages.map((message) => message.text),
      [preambleWithCount(1), "部分回复A"],
      "revival 必须补发 /stop 期间保留的部分回复",
    );
  } finally {
    await harness.dispose();
  }
});

// ---- 场景 10：字节 cap + 头部截断标记（utf8 字节口径，非 UTF-16 length——pitfall 13） ----

test("场景10 保留缓冲按 utf8 字节 cap（64KB）头部截断 + 一次性截断标记 + 尾部保留", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    // 22010 个 CJK 字符：utf8 字节 66030 > 65536（触发截断），但 UTF-16 length 22010 < 65536
    // （若 cap 误按 .length 计数则不会截断——pitfall 13 判别）。
    const bigText = `截头标记X${"字".repeat(22000)}截尾标记Y`;
    harness.sendControl.failPattern = /.*/u;
    harness.sendControl.errorFactory = channelDeadWeixinRetError;
    await enqueue(chunkEvent(bigText));
    await enqueue(toolCallEvent("tool-cap"));
    assert.equal(harness.sentMessages.length, 0, "死通道上没有任何成功发送");
    const deliveredHead = harness.sentMessages.map((message) => message.text).join("");
    assert.equal(deliveredHead.includes("截头标记X"), false, "头部超预算内容必须被截断");
    // 通道恢复：revival 补发截断标记 + 尾部积压。
    harness.sendControl.failPattern = undefined;
    harness.sendControl.errorFactory = undefined;
    await harness.triggerMessage({ text: "ping" });
    const deliveredTexts = harness.sentMessages.map((message) => message.text);
    assert.ok(deliveredTexts.includes(HEAD_TRUNCATED_ZH), "截断后必须补发一次性头部截断标记");
    assert.equal(
      deliveredTexts.filter((text) => text === HEAD_TRUNCATED_ZH).length,
      1,
      "截断标记只出现一次",
    );
    assert.ok(
      deliveredTexts.some((text) => text.includes("截尾标记Y")),
      "尾部内容必须保留并补发",
    );
    const deliveredJoined = deliveredTexts.join("");
    assert.equal(deliveredJoined.includes("截头标记X"), false, "被截断的头部不得补发");
    // 补发积压（除序言与标记外）字节总量不得超过 cap。
    const backlogBytes = deliveredTexts
      .filter((text) => text !== HEAD_TRUNCATED_ZH && !text.includes("已补发"))
      .reduce((total, text) => total + Buffer.byteLength(text, "utf8"), 0);
    assert.ok(backlogBytes <= 64 * 1024, `补发积压字节不得超过 64KB（实测 ${backlogBytes}）`);
  } finally {
    await harness.dispose();
  }
});

// ---- 场景 12：并发串行化（per-peer promise chain） ----

test("场景12 revival 补发与终态 drain 的 force 重试并发：per-peer 串行——积压不重复、不丢失、不乱序", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    // 先制造积压（channel-dead 保留）。
    harness.sendControl.failPattern = /积压一/u;
    harness.sendControl.errorFactory = channelDeadWeixinRetError;
    await enqueue(chunkEvent("积压一"));
    await enqueue(toolCallEvent("tool-race-a"));
    // 通道恢复；门控积压投递（revival flush 在锁内挂起）。
    harness.sendControl.failPattern = undefined;
    harness.sendControl.errorFactory = undefined;
    const gate = createDeferred();
    harness.sendControl.gate = (text) => (text === "积压一" ? gate.promise : undefined);
    // revival 入站（入站队列内）：序言已发、积压一门控中。
    const revivalPromise = harness.triggerMessage({ text: "ping 复活" });
    await waitForCondition(
      () => harness.sendAttempts.includes("积压一"),
      2000,
      "revival 开始补发积压",
    );
    // 与此同时终态事件（streamEventQueue——与入站队列并发的第三个触点）：
    // drain/终态 flush 的保留文本 force 重试必须等锁，不得并发取走同一积压。
    const terminalPromise = enqueue(taskCompleteEvent());
    await sleep(150);
    gate.resolve();
    await revivalPromise;
    await terminalPromise;
    // 积压恰一次、序言先行、完成回执照常（串行化无重复无丢失）。
    assert.equal(
      harness.sentMessages.filter((message) => message.text === "积压一").length,
      1,
      "并发 drain 的 force 重试不得重复补发积压",
    );
    const deliveredTexts = harness.sentMessages.map((message) => message.text);
    assert.ok(
      deliveredTexts.indexOf(preambleWithCount(1)) < deliveredTexts.indexOf("积压一"),
      "序言必须先于积压",
    );
    assert.ok(
      deliveredTexts.indexOf("积压一") < deliveredTexts.indexOf(TASK_COMPLETED_ZH),
      "积压补发必须先于终态完成回执",
    );
  } finally {
    await harness.dispose();
  }
});

test("场景12 /stop 排干与在途 flush 并发：channel-dead 保留恰一次、不丢失、不重复", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage();
    const enqueue = await requireEnqueue(harness);
    // >3500 字符切成 2 个分块；第一分块发送被门控挂起（flush 在途），
    // 门控释放后按 channel-dead 失败（failPattern 与 errorFactory 同时设置）。
    const twoChunkText = `${"甲".repeat(3500)}${"乙".repeat(3500)}`;
    const gate = createDeferred();
    harness.sendControl.gate = (text) => (text.includes("甲") ? gate.promise : undefined);
    harness.sendControl.failPattern = /.*/u;
    harness.sendControl.errorFactory = channelDeadWeixinRetError;
    const flushPromise = (async () => {
      await enqueue(chunkEvent(twoChunkText));
      await enqueue(toolCallEvent("tool-race-b"));
    })();
    await waitForCondition(
      () => harness.sendAttempts.some((text) => text.includes("甲")),
      2000,
      "flush 开始发送第一分块（门控挂起中）",
    );
    // /stop 在 flush 在途时到达（入站队列 + 队列外 drain）。
    const stopReplies = await harness.triggerMessage({ text: "/stop" });
    assert.ok(stopReplies.length > 0, "/stop 必须有状态回复");
    assert.equal(harness.getStreamEnqueue(), undefined, "/stop 后 watcher 必须拆除");
    // 释放门控 → 第一分块 channel-dead：当前分块（缝隙）+ 未发送分块全部保留，恰一次尝试。
    gate.resolve();
    harness.sendControl.gate = undefined;
    await flushPromise;
    assert.equal(
      harness.sendAttempts.filter((text) => text.includes("甲")).length,
      1,
      "门控释放后 channel-dead 首败即停",
    );
    assert.equal(
      harness.sendAttempts.some((text) => text.includes("乙")),
      false,
      "未发送分块不得在死通道上尝试",
    );
    assert.equal(harness.sentMessages.length, 0, "死通道上没有任何成功发送");
    // revival：两个分块按序各补发一次。
    harness.sendControl.failPattern = undefined;
    harness.sendControl.errorFactory = undefined;
    await harness.triggerMessage({ text: "ping" });
    const deliveredTexts = harness.sentMessages.map((message) => message.text);
    assert.equal(
      deliveredTexts.filter((text) => text.includes("甲") && !text.includes("已补发")).length,
      1,
      "第一分块恰一次补发",
    );
    assert.equal(
      deliveredTexts.filter((text) => text.includes("乙")).length,
      1,
      "第二分块恰一次补发",
    );
    const firstChunkIndex = deliveredTexts.findIndex(
      (text) => text.includes("甲") && !text.includes("已补发"),
    );
    const secondChunkIndex = deliveredTexts.findIndex((text) => text.includes("乙"));
    assert.ok(firstChunkIndex < secondChunkIndex, "分块按序补发");
  } finally {
    await harness.dispose();
  }
});

// ---- 场景 8（M5）：writeContext 各调用路径不得回滚四个持久化字段 ----

const NEWER_UPDATED_AT = 1770000000000;

function newerPersistedFields(): Record<string, unknown> {
  return {
    weixinContextTokens: { "wx-chat-1": { token: "token-fresh", updatedAt: NEWER_UPDATED_AT } },
    weixinGetUpdatesBuf: "buf-new-999",
    telegramOffset: 999,
    weixinActivatedAt: NEWER_UPDATED_AT,
  };
}

async function assertPersistedCursorsPreserved(harness: Harness): Promise<void> {
  const entry = await harness.readStateBotEntry();
  const tokens = entry.weixinContextTokens as
    | Record<string, { token: string; updatedAt: number }>
    | undefined;
  assert.equal(tokens?.["wx-chat-1"]?.token, "token-fresh", "weixinContextTokens 不得回滚");
  assert.equal(entry.weixinGetUpdatesBuf, "buf-new-999", "weixinGetUpdatesBuf 不得回滚");
  assert.equal(entry.telegramOffset, 999, "telegramOffset 不得回滚");
  assert.equal(entry.weixinActivatedAt, NEWER_UPDATED_AT, "weixinActivatedAt 不得回滚");
}

test("场景8 M5 属性：elicitation_response 清除路径（:4448）不回滚 token/游标/激活字段", async () => {
  const harness = await createHarness();
  try {
    // watcher 捕获的 context 带 token-stale 时代的四个字段值。
    await harness.triggerMessage({ providerContextToken: "token-stale" });
    const enqueue = await requireEnqueue(harness);
    // 交互事件把 pendingElicitation 写入捕获 context（Object.assign）。
    await enqueue(elicitationRequestEvent("req-el-1"));
    // 持久化状态被后续入站/游标写入更新为更新值（watcher 捕获的仍是旧值）。
    await harness.overwritePersistedBotEntry(newerPersistedFields());
    // 清除路径 writeContext({...捕获 context, pendingElicitation: undefined})。
    await enqueue(elicitationResponseEvent("req-el-1"));
    await assertPersistedCursorsPreserved(harness);
    const entry = await harness.readStateBotEntry();
    assert.ok(!entry.pendingElicitation, "清除路径自身的写入语义必须保留（pending 已清除）");
  } finally {
    await harness.dispose();
  }
});

test("场景8 M5 属性：终态 pendingElicitation 清除路径（:5371）不回滚四个持久化字段", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage({ providerContextToken: "token-stale" });
    const enqueue = await requireEnqueue(harness);
    await enqueue(elicitationRequestEvent("req-el-2"));
    await harness.overwritePersistedBotEntry(newerPersistedFields());
    await enqueue(taskCompleteEvent());
    await assertPersistedCursorsPreserved(harness);
    const entry = await harness.readStateBotEntry();
    assert.ok(!entry.pendingElicitation, "终态清除路径自身的写入语义必须保留");
  } finally {
    await harness.dispose();
  }
});

test("场景8 M5 属性：permission_request 写路径（:5282）不回滚四个持久化字段", async () => {
  const harness = await createHarness();
  try {
    await harness.triggerMessage({ providerContextToken: "token-stale" });
    const enqueue = await requireEnqueue(harness);
    await harness.overwritePersistedBotEntry(newerPersistedFields());
    await enqueue(permissionRequestEvent());
    await assertPersistedCursorsPreserved(harness);
    const entry = await harness.readStateBotEntry();
    assert.ok(
      Array.isArray(entry.pendingPermissionOptions) && entry.pendingPermissionOptions.length > 0,
      "权限写路径自身的写入语义必须保留（pending options 已持久化）",
    );
  } finally {
    await harness.dispose();
  }
});

test("场景8 M5 属性：/new 草稿写入（读-写窗口内持久化被并发更新）不回滚四个持久化字段", async () => {
  const harness = await createHarness();
  try {
    // 不预建 watcher：/new 直接进入草稿写入；getTaskSnapshot 挂起制造读-写窗口。
    harness.snapshotControl.hangDeferred = createDeferred();
    const newPromise = harness.triggerMessage({ text: "/new" });
    await sleep(150);
    // 窗口内：持久化 token/游标/激活被并发写入更新值（入站 ping + 游标推进）。
    await harness.overwritePersistedBotEntry(newerPersistedFields());
    harness.snapshotControl.hangDeferred.resolve();
    harness.snapshotControl.hangDeferred = undefined;
    const replies = await newPromise;
    assert.ok(replies.length > 0, "/new 必须有草稿状态回复");
    await assertPersistedCursorsPreserved(harness);
    const entry = await harness.readStateBotEntry();
    assert.equal(entry.mode, "draft", "/new 自身语义必须保留（进入草稿）");
  } finally {
    await harness.dispose();
  }
});
