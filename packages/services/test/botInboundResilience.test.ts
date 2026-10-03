import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IDisposable } from "@zcode/rpc";
import type {
  BotConfig,
  BotInboundMessage,
  BotOutboundMessage,
  BotPendingElicitation,
  BotStructuredElicitationResponse,
} from "@zcode/shared";
import { ZCODE_AGENT_PROVIDER } from "@zcode/shared";
import { createBotsService } from "../src/bots/botsService.js";
import { BOTS_CONFIG_FILE, BOTS_STATE_FILE } from "../src/bots/config.js";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";
import type { IBotsService } from "../src/bots/bots.js";
import type { IZCodeTaskService } from "../src/session/zcodeTaskService.js";
import type { ICredentialService } from "../src/credential/credential.js";
import type { IModelSelectionService } from "../src/model-provider/providerFacadeServices.js";
import type { ISettingService } from "../src/setting/setting.js";
import type { BotProviderAdapter } from "../src/bots/providers/types.js";
import { formatBotMessage } from "../src/bots/messages.js";

// specs/bot-inbound-resilience.md（3.14.5-alpha.3）验收场景 1/2/3/4/5/11（Worker A：
// B1 consumed 契约 + C 去重键保留）+ 场景 7/8/9/12/13（Worker C：B2 会话失败信号）。
// 失败注入走 createTask stub（草稿首发路径的确定性业务失败，§2b 事故同层）；
// ok 断言一律经 handleProviderCallbackResponse——handleProviderCallback 只返回
// replies，无法表达 ok=false。

const WEIXIN_BOT_ID = "bot-wx-inbound";
const TELEGRAM_BOT_ID = "bot-tg-inbound";
const FEISHU_BOT_ID = "bot-fs-inbound";
const POISON_TEXT = "毒消息";
const NOTICE_MARKER = "处理机器人回调失败";
const BUSINESS_FAILURE = "deterministic business failure (test)";

type CallbackProvider = "weixin" | "telegram" | "feishu";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function baseAllowedCommands() {
  return {
    status: true,
    new: true,
    workspace: true,
    model: true,
    thoughtLevel: true,
    reply: true,
    file: true,
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

interface CapturedFetchCall {
  url: string;
  init: RequestInit | undefined;
}

type FetchRouter = (call: CapturedFetchCall) => Response | Promise<Response>;

function createRecordingFetch(router: FetchRouter): {
  fetch: typeof globalThis.fetch;
  calls: CapturedFetchCall[];
} {
  const calls: CapturedFetchCall[] = [];
  const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return router(call);
  }) as typeof globalThis.fetch;
  return { fetch: stub, calls };
}

/** 长轮询挂起应答：等到 runtime dispose 的 abort 再以 AbortError 收口。 */
function hangUntilAborted(call: CapturedFetchCall): Promise<Response> {
  return new Promise<Response>((_, reject) => {
    call.init?.signal?.addEventListener(
      "abort",
      () => reject(new DOMException("Aborted", "AbortError")),
      { once: true },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(condition: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return true;
    }
    await sleep(50);
  }
  return condition();
}

/** 捕获 console.log（createServiceLogger("bots") info 的缺省 sink），finally 恢复。 */
function captureConsoleLog(): { lines: string[]; restore(): void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };
  return {
    lines,
    restore: () => {
      console.log = original;
    },
  };
}

interface TaskServiceControls {
  sentMessages: BotOutboundMessage[];
  createTaskCalls: string[];
  sendPromptCalls: string[];
  /** respondElicitation 调用记录（含抛错的那次——先记录再失败）。 */
  respondElicitationCalls: Array<{
    taskId: string;
    requestId: string;
    action: "accept" | "decline" | "cancel";
    content: Record<string, unknown> | undefined;
  }>;
  respondPermissionCalls: Array<{
    taskId: string;
    requestId: string;
    optionId: string;
    response: Record<string, unknown>;
  }>;
  stopGenerationCalls: string[];
  /** taskId → watchTaskStream 注册的 stream event handler（测试直接投递事件）。 */
  streamEventHandlers: Map<string, (event: unknown) => Promise<void>>;
}

function buildFakeTaskService(
  controls: TaskServiceControls,
  createTaskFailures: number,
  respondElicitationFailures: number,
) {
  let failuresLeft = createTaskFailures;
  let respondElicitationFailuresLeft = respondElicitationFailures;
  let createdCount = 0;
  return {
    listDeletedTaskIds: async () => [] as string[],
    resumeTask: async () => undefined,
    createTask: async () => {
      controls.createTaskCalls.push(`create-${controls.createTaskCalls.length + 1}`);
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error(BUSINESS_FAILURE);
      }
      createdCount += 1;
      return { taskId: `task-created-${createdCount}` };
    },
    deleteTask: async () => undefined,
    stopGeneration: async (params: { taskId: string }) => {
      controls.stopGenerationCalls.push(params.taskId);
    },
    respondPermission: async (params: {
      taskId: string;
      requestId: string;
      optionId: string;
      response: Record<string, unknown>;
    }) => {
      controls.respondPermissionCalls.push({
        taskId: params.taskId,
        requestId: params.requestId,
        optionId: params.optionId,
        response: params.response,
      });
      return true;
    },
    respondElicitation: async (params: {
      taskId: string;
      requestId: string;
      action: "accept" | "decline" | "cancel";
      content?: Record<string, unknown>;
    }) => {
      controls.respondElicitationCalls.push({
        taskId: params.taskId,
        requestId: params.requestId,
        action: params.action,
        content: params.content,
      });
      if (respondElicitationFailuresLeft > 0) {
        respondElicitationFailuresLeft -= 1;
        throw new Error(BUSINESS_FAILURE);
      }
      return true;
    },
    getTaskModelSelection: async () => ({
      providerId: ZCODE_AGENT_PROVIDER,
      modelId: "glm-test",
    }),
    getTaskConfigOptions: async () => [],
    listTasks: async () => [],
    getTaskSnapshot: async () => null,
    sendPrompt: async (request: { taskId: string }) => {
      controls.sendPromptCalls.push(request.taskId);
    },
    setMode: async () => undefined,
    onDynamicStreamEvent:
      (taskId: string) =>
      (handler: (event: unknown) => Promise<void>): IDisposable => {
        controls.streamEventHandlers.set(taskId, handler);
        return {
          dispose: () => {
            controls.streamEventHandlers.delete(taskId);
          },
        };
      },
  };
}

function buildModelSelectionService() {
  const modelSelection = { providerId: ZCODE_AGENT_PROVIDER, modelId: "glm-test" };
  return {
    getView: async () =>
      ({
        revision: 1,
        providers: [],
        preferredSelection: modelSelection,
        effectiveSelection: modelSelection,
      }) as unknown as Awaited<ReturnType<IModelSelectionService["getView"]>>,
  };
}

/** 场景 6（Fix A）：无可解析 preferred 选择的目标 Host——无模型 workspace 形态。 */
function buildNoModelSelectionService() {
  return {
    getView: async () =>
      ({
        revision: 1,
        providers: [],
      }) as unknown as Awaited<ReturnType<IModelSelectionService["getView"]>>,
  };
}

/** 场景 6（Fix A）：草稿已保存选择但 Host 解析失败（selectionIssue 形态）。 */
function buildInvalidSelectionService() {
  return {
    getView: async () =>
      ({
        revision: 1,
        providers: [],
        effectiveSelection: null,
        selectionIssue: "model-not-found",
      }) as unknown as Awaited<ReturnType<IModelSelectionService["getView"]>>,
  };
}

async function prepareWorkspaceDirs(prefix: string): Promise<{
  dataRoot: string;
  workspace: string;
  configDir: string;
}> {
  const dataRoot = await mkdtemp(join(tmpdir(), `${prefix}-`));
  setDataBaseDir(dataRoot);
  const workspace = await mkdtemp(join(tmpdir(), `${prefix}-ws-`));
  await writeFile(join(workspace, "out.txt"), "hello");
  const configDir = getAppConfigDir();
  await mkdir(configDir, { recursive: true });
  return { dataRoot, workspace, configDir };
}

function botDefaults() {
  return {
    enabled: true,
    allowedWorkspaces: ["*"],
    allowedCommands: baseAllowedCommands(),
    currentOptions: {},
  };
}

/** 草稿模式 state entry：普通消息走 createTask 首发路径（activeTaskId 必须显式 null）。 */
function draftStateEntry(
  botId: string,
  workspace: string,
  isWeixin: boolean,
  withStaleSelection = false,
) {
  return {
    botId,
    workspacePath: workspace,
    mode: "draft",
    activeTaskId: null,
    ...(isWeixin ? { weixinActivatedAt: 1 } : {}),
    ...(withStaleSelection
      ? {
          draftOptions: {
            provider: ZCODE_AGENT_PROVIDER,
            modelSelection: { providerId: ZCODE_AGENT_PROVIDER, modelId: "glm-gone" },
          },
        }
      : {}),
    updatedAt: 1,
  };
}

interface TaskStateEntryOptions {
  activeTaskId: string;
  isWeixin?: boolean;
  pendingElicitation?: Record<string, unknown>;
  pendingPermissionOptions?: Array<Record<string, unknown>>;
}

/** task 模式 state entry：B2 场景在既有任务上回答 pending 交互（activeTaskId 必须命中）。 */
function taskStateEntry(botId: string, workspace: string, options: TaskStateEntryOptions) {
  return {
    botId,
    workspacePath: workspace,
    mode: "task",
    activeTaskId: options.activeTaskId,
    ...(options.isWeixin ? { weixinActivatedAt: 1 } : {}),
    ...(options.pendingElicitation ? { pendingElicitation: options.pendingElicitation } : {}),
    ...(options.pendingPermissionOptions
      ? { pendingPermissionOptions: options.pendingPermissionOptions }
      : {}),
    updatedAt: 1,
  };
}

/**
 * pendingElicitation fixture。actorKey 必须与 getActorContextKey(actor) 同构：
 * [botId, provider, chatId ?? providerUserId]——私聊约定统一省略 chatId（pitfall 2/12）。
 */
function pendingElicitationFixture(params: {
  botId: string;
  provider: string;
  providerUserId: string;
  taskId: string;
  requestId: string;
  questionCount?: number;
  currentQuestionIndex?: number;
}): Record<string, unknown> {
  const questionCount = params.questionCount ?? 1;
  return {
    taskId: params.taskId,
    requestId: params.requestId,
    runId: `run-${params.requestId}`,
    actorKey: [params.botId, params.provider, params.providerUserId].join("::"),
    currentQuestionIndex: params.currentQuestionIndex ?? questionCount - 1,
    questions: Array.from({ length: questionCount }, (_, index) => ({
      question: `问题${index + 1}：选颜色？`,
      header: "颜色",
      options: [
        { value: "red", label: "红" },
        { value: "blue", label: "蓝" },
      ],
    })),
    answers: {},
  } satisfies BotPendingElicitation;
}

/** 读取 bot-state.v3.json 中指定 bot entry（断言持久化交互状态的最终事实）。 */
async function readStateBotEntry(botId: string): Promise<Record<string, unknown>> {
  const state = JSON.parse(await readFile(join(getAppConfigDir(), BOTS_STATE_FILE), "utf8")) as {
    bots?: Record<string, Record<string, unknown>>;
  };
  return state.bots?.[botId] ?? {};
}

async function writeBotFiles(
  configDir: string,
  botConfig: BotConfig,
  stateEntry: Record<string, unknown>,
): Promise<void> {
  await writeFile(
    join(configDir, BOTS_CONFIG_FILE),
    JSON.stringify({ version: 3, bots: [botConfig] }),
  );
  await writeFile(
    join(configDir, BOTS_STATE_FILE),
    JSON.stringify({ version: 3, bots: { [botConfig.id]: stateEntry } }),
  );
}

// ---- 服务级 harness：fake adapter（weixin/telegram）或真实 feishu provider + fetch 路由 ----

interface CallbackHarnessOptions {
  provider: CallbackProvider;
  /** 前 N 次 createTask 抛错——确定性业务失败注入。 */
  createTaskFailures?: number;
  /** 前 N 次 respondElicitation 抛错——B2 入站方向的回答处理失败注入。 */
  respondElicitationFailures?: number;
  /** 匹配文本的出站 send 抛错——死通道（通知未送达/提问发不出）注入。 */
  failNoticeSendPattern?: RegExp;
  /** prepareCallbackPayload 抛错——基础设施失败（401 形态）注入。 */
  prepareCallbackFails?: boolean;
  /** 覆盖默认草稿 state entry（B2 用 task 模式 + pending 交互 fixture）。 */
  stateEntry?: (botId: string, workspace: string) => Record<string, unknown>;
  /** 场景 6（Fix A）：Host 无可解析 preferred 选择——无模型草稿形态。 */
  noModelSelection?: boolean;
  /** 场景 6（Fix A）：草稿带已保存但失效的 modelSelection（selectionIssue 形态）。 */
  invalidDraftSelection?: boolean;
  /** 场景 6（Fix A）：经 settingService 注入 bot locale（缺省 zh-CN）。 */
  locale?: "en-US";
}

interface CallbackHarness {
  service: IBotsService & { disposeAllAndWait(): Promise<void> };
  sentMessages: BotOutboundMessage[];
  createTaskCalls: string[];
  sendPromptCalls: string[];
  respondElicitationCalls: TaskServiceControls["respondElicitationCalls"];
  respondPermissionCalls: TaskServiceControls["respondPermissionCalls"];
  stopGenerationCalls: string[];
  streamEventHandlers: Map<string, (event: unknown) => Promise<void>>;
  dispose(): Promise<void>;
}

async function createCallbackHarness(options: CallbackHarnessOptions): Promise<CallbackHarness> {
  const provider = options.provider;
  const { dataRoot, workspace, configDir } = await prepareWorkspaceDirs("zcode-bot-inbound");

  const botConfig: BotConfig =
    provider === "feishu"
      ? {
          id: FEISHU_BOT_ID,
          name: "Feishu Inbound Bot",
          provider: "feishu",
          feishuAppId: "cli_inbound_1",
          credentialRef: "feishu-inbound-secret",
          // 非 weixin provider 的 findAuthorizedBot 按 providerUserId 匹配。
          providerUserId: "ou_inbound_1",
          ...botDefaults(),
          replyMode: "streaming_card",
        }
      : provider === "telegram"
        ? {
            id: TELEGRAM_BOT_ID,
            name: "Telegram Inbound Bot",
            provider: "telegram",
            credentialRef: "telegram-token-ref",
            providerUserId: "4242",
            ...botDefaults(),
            replyMode: "assistant_changes",
          }
        : {
            id: WEIXIN_BOT_ID,
            name: "Weixin Inbound Bot",
            provider: "weixin",
            credentialRef: "weixin-token-ref",
            providerUserId: "wx-bot-self",
            ...botDefaults(),
            replyMode: "assistant_changes",
          };
  await writeBotFiles(
    configDir,
    botConfig,
    options.stateEntry?.(botConfig.id, workspace) ??
      draftStateEntry(
        botConfig.id,
        workspace,
        provider === "weixin",
        options.invalidDraftSelection,
      ),
  );

  const controls: TaskServiceControls = {
    sentMessages: [],
    createTaskCalls: [],
    sendPromptCalls: [],
    respondElicitationCalls: [],
    respondPermissionCalls: [],
    stopGenerationCalls: [],
    streamEventHandlers: new Map(),
  };
  const fakeTaskService = buildFakeTaskService(
    controls,
    options.createTaskFailures ?? 0,
    options.respondElicitationFailures ?? 0,
  );
  const modelSelectionService = options.noModelSelection
    ? buildNoModelSelectionService()
    : options.invalidDraftSelection
      ? buildInvalidSelectionService()
      : buildModelSelectionService();
  const credentialValues: Record<string, string> = {
    "weixin-token-ref": "wx-token-inbound",
    "telegram-token-ref": "tg-token-inbound",
    "feishu-inbound-secret": "fs-secret-inbound",
  };
  const credentialService = {
    load: async (key: string) => credentialValues[key] ?? null,
  } as unknown as ICredentialService;

  // 与 weixinProvider.buildInboundMessage 对齐：私聊消息必须完全省略 chatId（带 chatId
  // 会被解析成群聊，走“暂不支持群聊”分支）。
  const fakeWeixinAdapter: BotProviderAdapter = {
    test: async () => ({ ok: true, message: "stub" }),
    send: async (_bot, message) => {
      if (options.failNoticeSendPattern?.test(message.text)) {
        throw new Error("dead channel (test)");
      }
      controls.sentMessages.push(message);
    },
    ...(options.prepareCallbackFails
      ? {
          prepareCallbackPayload: async () => {
            throw new Error("prepare rejected (test)");
          },
        }
      : {}),
    parseCallback: (payload): BotInboundMessage[] => {
      if (!isRecord(payload)) {
        return [];
      }
      const botId = typeof payload.botId === "string" ? payload.botId : "";
      if (!botId) {
        return [];
      }
      const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
      const parsed: BotInboundMessage[] = [];
      for (const raw of rawMessages) {
        if (!isRecord(raw)) {
          continue;
        }
        const text = typeof raw.text === "string" ? raw.text.trim() : "";
        const providerUserId = typeof raw.from === "string" ? raw.from.trim() : "";
        if (!text || !providerUserId) {
          continue;
        }
        parsed.push({
          botId,
          text,
          // webhook provider 的结构化问答回执（parseWebhookElicitationResponse 同构）：
          // 场景 13 用它在中段（第 2/3 题）触发整组 submit。
          ...(isRecord(raw.elicitationResponse)
            ? {
                elicitationResponse: raw.elicitationResponse as BotStructuredElicitationResponse,
              }
            : {}),
          actor: {
            provider: "weixin",
            botId,
            providerUserId,
            chatType: "private",
            providerMessageId:
              typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : undefined,
          },
        });
      }
      return parsed;
    },
  };

  // 与 telegramProvider.readTelegramPrivateMessage 对齐（私聊文本消息）。
  const fakeTelegramAdapter: BotProviderAdapter = {
    test: async () => ({ ok: true, message: "stub" }),
    send: async (_bot, message) => {
      if (options.failNoticeSendPattern?.test(message.text)) {
        throw new Error("dead channel (test)");
      }
      controls.sentMessages.push(message);
    },
    parseCallback: (payload): BotInboundMessage[] => {
      if (!isRecord(payload)) {
        return [];
      }
      const botId = typeof payload.botId === "string" ? payload.botId : "";
      const update = isRecord(payload.update) ? payload.update : null;
      const message = update && isRecord(update.message) ? update.message : null;
      if (!botId || !message) {
        return [];
      }
      const from = isRecord(message.from) ? message.from : null;
      const chat = isRecord(message.chat) ? message.chat : null;
      const text = typeof message.text === "string" ? message.text.trim() : "";
      const userId =
        from && (typeof from.id === "number" || typeof from.id === "string") ? String(from.id) : "";
      if (!text || !userId) {
        return [];
      }
      return [
        {
          botId,
          text,
          actor: {
            provider: "telegram",
            botId,
            providerUserId: userId,
            chatType: chat?.type === "private" ? "private" : "group",
            chatId:
              chat && (typeof chat.id === "number" || typeof chat.id === "string")
                ? String(chat.id)
                : undefined,
            providerMessageId:
              typeof message.message_id === "number" || typeof message.message_id === "string"
                ? String(message.message_id)
                : undefined,
          },
        },
      ];
    },
  };

  const feishuRouter: FetchRouter = (call) => {
    const url = call.url;
    if (!url.startsWith("https://open.feishu.cn/")) {
      throw new Error(`unexpected bot egress url: ${url}`);
    }
    if (url.includes("/auth/v3/tenant_access_token/internal")) {
      return jsonResponse({ code: 0, tenant_access_token: "t-inbound-feishu", expire: 7200 });
    }
    if (url.includes("/reactions")) {
      return jsonResponse({ code: 0, data: { reaction_id: "rx-inbound-1" } });
    }
    return jsonResponse({ code: 0, data: { message_id: "om-out-inbound" } });
  };
  const feishuRecorder = createRecordingFetch(feishuRouter);

  const service = createBotsService({
    credentialService,
    zcodeTaskService: fakeTaskService as unknown as IZCodeTaskService,
    modelSelectionService,
    runStartupBackgroundTasks: false,
    ...(options.locale
      ? {
          settingService: {
            get: async () => ({ locale: options.locale }),
          } as unknown as ISettingService,
        }
      : {}),
    ...(provider === "feishu"
      ? { providerFetch: feishuRecorder.fetch }
      : {
          providerOverrides:
            provider === "telegram"
              ? { telegram: fakeTelegramAdapter }
              : { weixin: fakeWeixinAdapter },
        }),
  });

  return {
    service,
    sentMessages: controls.sentMessages,
    createTaskCalls: controls.createTaskCalls,
    sendPromptCalls: controls.sendPromptCalls,
    respondElicitationCalls: controls.respondElicitationCalls,
    respondPermissionCalls: controls.respondPermissionCalls,
    stopGenerationCalls: controls.stopGenerationCalls,
    streamEventHandlers: controls.streamEventHandlers,
    async dispose() {
      await service.disposeAllAndWait().catch(() => undefined);
      setDataBaseDir(null);
      await rm(dataRoot, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    },
  };
}

// 原始回调 payload 构造（与各 channel runtime 转发形状一致）。

function weixinInboundPayload(
  messages: Array<{
    id: string;
    text: string;
    from?: string;
    elicitationResponse?: Record<string, unknown>;
  }>,
): unknown {
  return {
    botId: WEIXIN_BOT_ID,
    messages: messages.map((message) => ({
      id: message.id,
      from: message.from ?? "wx-user-1",
      text: message.text,
      ...(message.elicitationResponse ? { elicitationResponse: message.elicitationResponse } : {}),
    })),
  };
}

function telegramInboundPayload(updateId: number, messageId: number, text: string): unknown {
  return {
    botId: TELEGRAM_BOT_ID,
    update: {
      update_id: updateId,
      message: {
        message_id: messageId,
        from: { id: 4242 },
        chat: { id: 4242, type: "private" },
        text,
      },
    },
  };
}

function feishuInboundPayload(messageId: string, text: string): unknown {
  return {
    botId: FEISHU_BOT_ID,
    event: {
      sender: { sender_id: { open_id: "ou_inbound_1" } },
      message: {
        message_id: messageId,
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text }),
      },
    },
  };
}

// ---- 轮询级 harness：真实 provider + providerFetch 路由（botProviderNetwork 场景9 模式）----

interface PollerHarness {
  service: IBotsService & { disposeAllAndWait(): Promise<void> };
  botId: string;
  getUpdatesCalls: CapturedFetchCall[];
  dispose(): Promise<void>;
}

interface PollerHarnessOptions {
  provider: "weixin" | "telegram";
  createTaskFailures?: number;
  getUpdatesOutcome?: (call: CapturedFetchCall, count: number) => Response | Promise<Response>;
  weixinGetUpdatesOutcome?: (
    call: CapturedFetchCall,
    count: number,
  ) => Response | Promise<Response>;
}

async function createPollerHarness(options: PollerHarnessOptions): Promise<PollerHarness> {
  const provider = options.provider;
  const { dataRoot, workspace, configDir } = await prepareWorkspaceDirs("zcode-bot-inbound-poll");

  const botId = provider === "weixin" ? "bot-wx-poll" : "bot-tg-poll";
  const botConfig: BotConfig =
    provider === "weixin"
      ? {
          id: botId,
          name: "Weixin Poll Bot",
          provider: "weixin",
          credentialRef: "weixin-token-ref",
          providerUserId: "wx-bot-self",
          ...botDefaults(),
          replyMode: "assistant_changes",
        }
      : {
          id: botId,
          name: "Telegram Poll Bot",
          provider: "telegram",
          credentialRef: "telegram-token-ref",
          providerUserId: "4242",
          ...botDefaults(),
          replyMode: "assistant_changes",
        };
  await writeBotFiles(
    configDir,
    botConfig,
    draftStateEntry(botId, workspace, provider === "weixin"),
  );

  const controls: TaskServiceControls = {
    sentMessages: [],
    createTaskCalls: [],
    sendPromptCalls: [],
    respondElicitationCalls: [],
    respondPermissionCalls: [],
    stopGenerationCalls: [],
    streamEventHandlers: new Map(),
  };
  const fakeTaskService = buildFakeTaskService(controls, options.createTaskFailures ?? 0, 0);
  const modelSelectionService = buildModelSelectionService();
  const credentialValues: Record<string, string> = {
    "weixin-token-ref": "wx-token-inbound",
    "telegram-token-ref": "tg-token-inbound",
  };
  const credentialService = {
    load: async (key: string) => credentialValues[key] ?? null,
  } as unknown as ICredentialService;

  let getUpdatesCount = 0;
  const getUpdatesCalls: CapturedFetchCall[] = [];
  const router: FetchRouter = (call) => {
    const url = call.url;
    if (url.startsWith("https://api.telegram.org/bot")) {
      if (url.endsWith("/getUpdates")) {
        getUpdatesCount += 1;
        getUpdatesCalls.push(call);
        return (
          options.getUpdatesOutcome?.(call, getUpdatesCount) ??
          jsonResponse({ ok: true, result: [] })
        );
      }
      return jsonResponse({ ok: true });
    }
    if (url.startsWith("https://ilinkai.weixin.qq.com/")) {
      if (url.includes("/getupdates")) {
        getUpdatesCount += 1;
        getUpdatesCalls.push(call);
        return (
          options.weixinGetUpdatesOutcome?.(call, getUpdatesCount) ??
          jsonResponse({ ret: 0, errcode: 0, data: { msgs: [] } })
        );
      }
      return jsonResponse({ ret: 0, errcode: 0 });
    }
    throw new Error(`unexpected bot egress url: ${url}`);
  };
  const recorder = createRecordingFetch(router);

  const service = createBotsService({
    credentialService,
    zcodeTaskService: fakeTaskService as unknown as IZCodeTaskService,
    modelSelectionService,
    runStartupBackgroundTasks: true,
    providerFetch: recorder.fetch,
  });

  return {
    service,
    botId,
    getUpdatesCalls,
    async dispose() {
      await service.disposeAllAndWait().catch(() => undefined);
      setDataBaseDir(null);
      await rm(dataRoot, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    },
  };
}

/** 轮询读取 bot-state.v3.json 中目标 bot entry 的指定字段（原子写中途的解析竞态重试）。 */
async function waitForStateBotField(
  botId: string,
  pick: (entry: Record<string, unknown>) => unknown,
  timeoutMs = 10_000,
): Promise<unknown> {
  const path = join(getAppConfigDir(), BOTS_STATE_FILE);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = JSON.parse(await readFile(path, "utf8")) as {
        bots?: Record<string, Record<string, unknown>>;
      };
      const entry = state.bots?.[botId];
      if (entry) {
        const value = pick(entry);
        if (value !== undefined) {
          return value;
        }
      }
    } catch {
      // 文件尚不存在或原子写替换中途：重试。
    }
    await sleep(50);
  }
  return undefined;
}

// ---- 场景 1：weixin 毒消息 ----

test("场景1（服务级）：weixin 毒消息业务失败——恰一条失败通知且送达 ⇒ consumed ⇒ ok=true，同批后续消息仍被处理", async () => {
  const harness = await createCallbackHarness({ provider: "weixin", createTaskFailures: 1 });
  const logCapture = captureConsoleLog();
  try {
    const result = await harness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([
        { id: "wx-msg-poison-1", text: POISON_TEXT },
        { id: "wx-msg-good-1", text: "正常消息" },
      ]),
    );
    assert.equal(result.ok, true, "失败通知已送达 ⇒ consumed ⇒ ok=true（游标可提交）");
    assert.equal(result.status, undefined, "consumed 失败不得携带错误状态（webhook 200 契约）");
    assert.equal(
      harness.sentMessages.filter((message) => message.text.includes(NOTICE_MARKER)).length,
      1,
      "毒消息必须恰好产生一条失败通知",
    );
    assert.ok(
      logCapture.lines.some(
        (line) =>
          line.includes("outcome=consumed-notice-delivered") &&
          line.includes("provider=weixin") &&
          line.includes("messageId=wx-msg-poison-1"),
      ),
      "每个 consumed 判定必须恰好落一行 info 日志",
    );
    assert.equal(
      harness.createTaskCalls.length,
      2,
      "同批后续消息必须继续处理（continue-on-failure）",
    );
    assert.ok(
      await waitForCondition(() => harness.sendPromptCalls.length >= 1, 5000),
      "后续正常消息必须走到 sendPrompt",
    );
  } finally {
    logCapture.restore();
    await harness.dispose();
  }
});

test("场景1（轮询级）：weixin 毒消息通知送达 ⇒ ok=true ⇒ writeWeixinGetUpdatesBuf 提交新 buf，下一轮携带新 buf", async () => {
  const harness = await createPollerHarness({
    provider: "weixin",
    createTaskFailures: 1,
    weixinGetUpdatesOutcome: (call, count) =>
      count === 1
        ? jsonResponse({
            ret: 0,
            errcode: 0,
            data: {
              msgs: [{ id: "wx-poison-poll-1", from_user_id: "wx-user-1", content: POISON_TEXT }],
              get_updates_buf: "wx-buf-next-1",
            },
          })
        : hangUntilAborted(call),
  });
  try {
    const buf = await waitForStateBotField(harness.botId, (entry) => entry.weixinGetUpdatesBuf);
    assert.notEqual(
      buf,
      undefined,
      "毒消息 consumed 后 buf 必须提交——否则微信服务端游标回退，同批消息无限重投（§2b 事故）",
    );
    assert.equal(buf, "wx-buf-next-1");
    assert.ok(
      await waitForCondition(() => harness.getUpdatesCalls.length >= 2, 5000),
      "buf 提交后轮询必须继续（第二次 /getupdates）",
    );
    const secondBody = JSON.parse(String(harness.getUpdatesCalls[1]?.init?.body)) as {
      get_updates_buf?: string;
    };
    assert.equal(secondBody.get_updates_buf, "wx-buf-next-1", "第二次轮询必须携带新提交的 buf");
  } finally {
    await harness.dispose();
  }
});

// ---- 场景 2：telegram ----

test("场景2（服务级）：telegram 毒消息业务失败——通知送达 ⇒ consumed ⇒ ok=true（runtime 逐条前移 offset 的前提契约）", async () => {
  const harness = await createCallbackHarness({ provider: "telegram", createTaskFailures: 1 });
  try {
    const result = await harness.service.handleProviderCallbackResponse(
      "telegram",
      telegramInboundPayload(5150, 100, POISON_TEXT),
    );
    assert.equal(result.ok, true, "失败通知已送达 ⇒ consumed ⇒ ok=true");
    assert.equal(result.status, undefined);
    assert.equal(
      harness.sentMessages.filter((message) => message.text.includes(NOTICE_MARKER)).length,
      1,
      "必须恰好一条失败通知",
    );
  } finally {
    await harness.dispose();
  }
});

test("场景2（轮询级）：telegram 毒消息通知送达 ⇒ ok=true ⇒ offset 逐条前移落盘", async () => {
  const harness = await createPollerHarness({
    provider: "telegram",
    createTaskFailures: 1,
    getUpdatesOutcome: (call, count) =>
      count === 1
        ? jsonResponse({
            ok: true,
            result: [
              {
                update_id: 5150,
                message: {
                  message_id: 100,
                  from: { id: 4242 },
                  chat: { id: 4242, type: "private" },
                  text: POISON_TEXT,
                },
              },
            ],
          })
        : hangUntilAborted(call),
  });
  try {
    const offset = await waitForStateBotField(harness.botId, (entry) => entry.telegramOffset);
    assert.notEqual(
      offset,
      undefined,
      "毒消息 consumed 后 offset 必须前移——否则 Telegram 无限重投（§2b 事故）",
    );
    assert.equal(offset, 5151, "offset 必须是已处理 update_id + 1");
  } finally {
    await harness.dispose();
  }
});

// ---- 场景 3：feishu ----

test("场景3：feishu 毒消息业务失败——通知送达 ⇒ consumed ⇒ ok=true（旧按钮残留按 spec B.5 接受，无需清理）", async () => {
  const harness = await createCallbackHarness({ provider: "feishu", createTaskFailures: 1 });
  try {
    const result = await harness.service.handleProviderCallbackResponse(
      "feishu",
      feishuInboundPayload("om_fs_poison_1", POISON_TEXT),
    );
    assert.equal(
      result.ok,
      true,
      "consumed 失败 ⇒ ok=true（feishu WS ACK 语义；残留按钮按 B.5 无害）",
    );
    assert.equal(result.status, undefined);
  } finally {
    await harness.dispose();
  }
});

// ---- 场景 4：洞规则 ----

test("场景4：洞规则——通知未送达（死通道）⇒ ok=false 不提交；同 id 首次重投被去重吞并 ⇒ ok=true ⇒ 可提交（一次重投周期内静默丢弃）", async () => {
  const harness = await createCallbackHarness({
    provider: "weixin",
    createTaskFailures: 2,
    failNoticeSendPattern: new RegExp(NOTICE_MARKER, "u"),
  });
  const logCapture = captureConsoleLog();
  try {
    const first = await harness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([{ id: "wx-msg-hole-1", text: POISON_TEXT }]),
    );
    assert.equal(first.ok, false, "通知未送达且无会话信号 ⇒ NOT consumed ⇒ 保持 abort-不提交");
    assert.equal(first.status, 503, "未消费失败保持 503（webhook/网关重试语义）");
    assert.ok(
      logCapture.lines.some(
        (line) =>
          line.includes("outcome=hole-not-consumed") && line.includes("messageId=wx-msg-hole-1"),
      ),
      "洞判定必须落一行 info 日志",
    );

    const redelivered = await harness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([{ id: "wx-msg-hole-1", text: POISON_TEXT }]),
    );
    assert.equal(
      redelivered.ok,
      true,
      "同 id 首次重投必须被去重吞并 ⇒ ok=true ⇒ 游标提交（一次重投周期内静默丢弃，有界自愈）",
    );
    assert.equal(redelivered.status, undefined);
    assert.equal(harness.createTaskCalls.length, 1, "重投必须零重复处理（去重键不再被释放）");
    assert.ok(
      logCapture.lines.some((line) => line.includes("provider callback duplicated")),
      "去重吞并必须落 duplicated 日志",
    );
  } finally {
    logCapture.restore();
    await harness.dispose();
  }
});

// ---- 场景 5：TTL 内同 id 重投 ----

test("场景5：consumed 失败后同 id 在 TTL 内重投 ⇒ 去重吞并、零重复处理", async () => {
  const harness = await createCallbackHarness({ provider: "weixin", createTaskFailures: 2 });
  try {
    const first = await harness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([{ id: "wx-msg-consumed-1", text: POISON_TEXT }]),
    );
    assert.equal(first.ok, true, "失败通知送达 ⇒ consumed ⇒ ok=true");
    const redelivered = await harness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([{ id: "wx-msg-consumed-1", text: POISON_TEXT }]),
    );
    assert.equal(redelivered.ok, true, "TTL 内同 id 重投必须被去重吞并");
    assert.equal(harness.createTaskCalls.length, 1, "零重复处理");
    assert.equal(
      harness.sentMessages.filter((message) => message.text.includes(NOTICE_MARKER)).length,
      1,
      "失败通知只发送一次",
    );
  } finally {
    await harness.dispose();
  }
});

// ---- 场景 6：无模型草稿（Fix A：可执行指引 + 可见陷阱）----

test("场景6（无模型草稿）：prompt ⇒ 本地化指引回复（zh/en 经 locale key 断言）、不 throw、不创建 task", async () => {
  // zh（缺省 locale）：§2b 事故的原始形态——无 draftOptions.modelSelection 且 Host 无 preferred。
  const zhHarness = await createCallbackHarness({ provider: "weixin", noModelSelection: true });
  try {
    const zh = await zhHarness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([{ id: "wx-msg-nomodel-1", text: "帮我分析一下这个项目" }]),
    );
    assert.equal(zh.ok, true, "指引回复是正常业务结果（非失败），ok=true");
    assert.equal(zh.status, undefined);
    assert.equal(
      zh.replies[0]?.text,
      formatBotMessage("zh-CN", "draftModelMissing"),
      "回复必须是 draftModelMissing 的 zh 文案（可执行指引，不是 throw 转译的 callbackFailed）",
    );
    assert.equal(
      zhHarness.sentMessages.filter((message) => message.text.includes(NOTICE_MARKER)).length,
      0,
      "不得走失败通知通道（不 throw）",
    );
    assert.equal(zhHarness.sentMessages[0]?.text, formatBotMessage("zh-CN", "draftModelMissing"));
    assert.equal(zhHarness.createTaskCalls.length, 0, "无模型 ⇒ 不创建 task");
  } finally {
    await zhHarness.dispose();
  }

  // en：同一指引跟随 bot locale。
  const enHarness = await createCallbackHarness({
    provider: "weixin",
    noModelSelection: true,
    locale: "en-US",
  });
  try {
    const en = await enHarness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([{ id: "wx-msg-nomodel-en-1", text: "analyze this project" }]),
    );
    assert.equal(en.ok, true);
    assert.equal(en.replies[0]?.text, formatBotMessage("en-US", "draftModelMissing"));
    assert.equal(enHarness.createTaskCalls.length, 0);
  } finally {
    await enHarness.dispose();
  }
});

test("场景6（无效选择）：草稿保存的 modelSelection 失效 ⇒ 本地化指引回复、不创建 task", async () => {
  const harness = await createCallbackHarness({
    provider: "weixin",
    invalidDraftSelection: true,
  });
  try {
    const result = await harness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([{ id: "wx-msg-invalid-sel-1", text: "继续上一个任务" }]),
    );
    assert.equal(result.ok, true, "selectionIssue 与无模型同构：正常指引回复，不 throw");
    assert.equal(
      result.replies[0]?.text,
      formatBotMessage("zh-CN", "draftModelInvalid"),
      "已保存但失效的选择必须用 draftModelInvalid 文案（区别于从未选择）",
    );
    assert.equal(harness.createTaskCalls.length, 0, "失效选择 ⇒ 不创建 task");
  } finally {
    await harness.dispose();
  }
});

test("场景6（可见陷阱）：无模型项目 /status 与 /new ack 的模型行显示明确“未设置/not set”文案", async () => {
  // zh（缺省 locale）：模型行不再是裸 "-"。
  const zhHarness = await createCallbackHarness({ provider: "weixin", noModelSelection: true });
  try {
    const zhUnsetLine = `${formatBotMessage("zh-CN", "statusModel")}: ${formatBotMessage("zh-CN", "statusModelUnset")}`;
    const statusResult = await zhHarness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([{ id: "wx-msg-status-1", text: "/status" }]),
    );
    assert.equal(statusResult.ok, true);
    assert.ok(
      statusResult.replies[0]?.text.split("\n").includes(zhUnsetLine),
      `/status 模型行必须显式显示“${zhUnsetLine}”`,
    );
    const newResult = await zhHarness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([{ id: "wx-msg-new-1", text: "/new" }]),
    );
    assert.equal(newResult.ok, true);
    // /new ack 即 createStatusReply——同一 buildStatusText 链路。
    assert.ok(
      newResult.replies[0]?.text.split("\n").includes(zhUnsetLine),
      `/new ack 模型行必须显式显示“${zhUnsetLine}”（首个 prompt 前可见陷阱）`,
    );
    assert.equal(zhHarness.createTaskCalls.length, 0);
  } finally {
    await zhHarness.dispose();
  }

  // en：同一标签跟随 bot locale。
  const enHarness = await createCallbackHarness({
    provider: "weixin",
    noModelSelection: true,
    locale: "en-US",
  });
  try {
    const enUnsetLine = `${formatBotMessage("en-US", "statusModel")}: ${formatBotMessage("en-US", "statusModelUnset")}`;
    const statusResult = await enHarness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([{ id: "wx-msg-status-en-1", text: "/status" }]),
    );
    assert.equal(statusResult.ok, true);
    assert.ok(
      statusResult.replies[0]?.text.split("\n").includes(enUnsetLine),
      `/status en 模型行必须显式显示“${enUnsetLine}”`,
    );
    const newResult = await enHarness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([{ id: "wx-msg-new-en-1", text: "/new" }]),
    );
    assert.ok(
      newResult.replies[0]?.text.split("\n").includes(enUnsetLine),
      `/new ack en 模型行必须显式显示“${enUnsetLine}”`,
    );
  } finally {
    await enHarness.dispose();
  }
});

// ---- 场景 11：回归钉住 ----

test("场景11（回归）：完全成功批次行为不变；prepare 401 基础设施失败仍 ok=false；consumed 失败结果不携带错误状态", async () => {
  // 完全成功批次：结果形状与旧行为一致（第一条草稿首发建任务、replies 为空；任务运行中
  // 第二条回复 taskRunning——同批两条都成功消费，ok=true、无 status）。
  const successHarness = await createCallbackHarness({ provider: "weixin" });
  try {
    const result = await successHarness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([
        { id: "wx-msg-ok-1", text: "第一条" },
        { id: "wx-msg-ok-2", text: "第二条" },
      ]),
    );
    assert.deepEqual(
      {
        ok: result.ok,
        status: result.status,
        replyTexts: result.replies.map((reply) => reply.text),
      },
      {
        ok: true,
        status: undefined,
        replyTexts: ["当前任务正在运行，稍后再试，或使用 **/停止** 停止当前任务。"],
      },
      "完全成功批次结果形状必须逐字节不变",
    );
    assert.equal(successHarness.createTaskCalls.length, 1);
    assert.equal(
      successHarness.sentMessages.filter((message) => message.text.includes(NOTICE_MARKER)).length,
      0,
      "成功批次不经失败通知通道",
    );
  } finally {
    await successHarness.dispose();
  }

  // 基础设施失败（prepare 401 形态）：发生在任何业务处理之前，abort-不提交保持。
  const infraHarness = await createCallbackHarness({
    provider: "weixin",
    prepareCallbackFails: true,
  });
  try {
    const result = await infraHarness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([{ id: "wx-msg-infra-1", text: POISON_TEXT }]),
    );
    assert.equal(result.ok, false, "prepare 失败必须保持 abort-不提交");
    assert.equal(result.status, 401);
    assert.equal(infraHarness.createTaskCalls.length, 0, "基础设施失败不得进入业务处理");
  } finally {
    await infraHarness.dispose();
  }
});

// ---- 场景 7：B2 出站方向（提问发送失败，死通道） ----

test("场景7（B2 出站）：pending elicitation 的提问发送失败 ⇒ respondElicitation 收到 decline+failureReason 且 pending 清除", async () => {
  const harness = await createCallbackHarness({
    provider: "weixin",
    // 提问文本含"选颜色"——只让提问发送失败（死通道），其余出站不受影响。
    failNoticeSendPattern: /选颜色/u,
    stateEntry: (botId, workspace) =>
      taskStateEntry(botId, workspace, { activeTaskId: "task-b2-out", isWeixin: true }),
  });
  try {
    // 1) 普通消息续跑任务并建立 stream watcher（fake onDynamicStreamEvent 捕获 handler）。
    const result = await harness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([{ id: "wx-msg-b2-out-1", text: "开始分析" }]),
    );
    assert.equal(result.ok, true);
    assert.ok(
      await waitForCondition(() => harness.streamEventHandlers.has("task-b2-out"), 5000),
      "必须建立 task stream watcher",
    );
    // 2) agent 发起 AskUserQuestion——提问发送撞死通道。
    await harness.streamEventHandlers.get("task-b2-out")?.({
      type: "elicitation_request",
      taskId: "task-b2-out",
      traceId: "run-b2-out",
      requestId: "req-b2-out",
      message: "问题1：选颜色？",
      header: "颜色",
      options: [
        { value: "red", label: "红" },
        { value: "blue", label: "蓝" },
      ],
    });
    assert.ok(
      await waitForCondition(
        () => harness.respondElicitationCalls.some((call) => call.action === "decline"),
        5000,
      ),
      "提问发送失败必须立即以 decline resolve 该 pending（会话失败信号）",
    );
    const decline = harness.respondElicitationCalls.find((call) => call.action === "decline");
    assert.equal(decline?.requestId, "req-b2-out");
    assert.equal(
      typeof decline?.content?.failureReason,
      "string",
      "failureReason 必须随 decline content 送达会话（复用既有 respondElicitation seam，无新 wire 类型）",
    );
    const entry = await readStateBotEntry(WEIXIN_BOT_ID);
    assert.equal(
      entry.pendingElicitation,
      undefined,
      "resolve 后 pending 必须清除（agent 可改道重问/默认/放弃）",
    );
  } finally {
    await harness.dispose();
  }
});

// ---- 场景 8：B2 入站方向（回答处理失败） ----

test("场景8（B2 入站）：owned pending 的回答处理失败 ⇒ decline+failureReason resolve 确认 ⇒ consumed(B1(b)) ⇒ ok=true", async () => {
  const harness = await createCallbackHarness({
    provider: "weixin",
    // 首次 respondElicitation（回答 submit）抛错 = 回答处理失败注入。
    respondElicitationFailures: 1,
    // 死通道：失败通知发不出去——consumed 只能经会话失败信号（B1(b)）成立，
    // 使 outcome=consumed-session-confirmed 可观测。
    failNoticeSendPattern: new RegExp(NOTICE_MARKER, "u"),
    stateEntry: (botId, workspace) =>
      taskStateEntry(botId, workspace, {
        activeTaskId: "task-b2-in",
        isWeixin: true,
        pendingElicitation: pendingElicitationFixture({
          botId,
          provider: "weixin",
          providerUserId: "wx-user-1",
          taskId: "task-b2-in",
          requestId: "req-b2-in",
          questionCount: 1,
          currentQuestionIndex: 0,
        }),
      }),
  });
  const logCapture = captureConsoleLog();
  try {
    const result = await harness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([{ id: "wx-msg-b2-in-1", text: "red" }]),
    );
    assert.equal(result.ok, true, "会话失败信号确认送达 ⇒ consumed（B1(b)）⇒ ok=true");
    assert.equal(result.status, undefined);
    assert.ok(
      logCapture.lines.some(
        (line) =>
          line.includes("outcome=consumed-session-confirmed") &&
          line.includes("messageId=wx-msg-b2-in-1"),
      ),
      "consumed 判定必须落 outcome=consumed-session-confirmed 一行 info",
    );
    assert.equal(
      harness.respondElicitationCalls.length,
      2,
      "恰好两次：首发 accept（业务失败注入点）+ B2 decline+failureReason 补偿 resolve",
    );
    assert.equal(harness.respondElicitationCalls[0]?.action, "accept");
    const decline = harness.respondElicitationCalls[1];
    assert.equal(decline?.action, "decline");
    assert.equal(typeof decline?.content?.failureReason, "string");
    const entry = await readStateBotEntry(WEIXIN_BOT_ID);
    assert.equal(entry.pendingElicitation, undefined, "pending 必须随整组 resolve 清除");
  } finally {
    logCapture.restore();
    await harness.dispose();
  }
});

// ---- 场景 9：B2 权限（休眠分支直测） ----

test("场景9（B2 权限休眠分支）：权限提示发送失败 ⇒ stopGeneration + respondPermission deny-shaped + pendingPermissionOptions 清除", async () => {
  const harness = await createCallbackHarness({
    provider: "weixin",
    // 全量出站 send 失败：驱动休眠分支（bot force-yolo 下生产不触发，测试直驱）。
    failNoticeSendPattern: /./u,
    stateEntry: (botId, workspace) =>
      taskStateEntry(botId, workspace, { activeTaskId: "task-b2-perm", isWeixin: true }),
  });
  try {
    const result = await harness.service.handleProviderCallbackResponse(
      "weixin",
      weixinInboundPayload([{ id: "wx-msg-b2-perm-1", text: "开始分析" }]),
    );
    assert.equal(result.ok, true);
    assert.ok(
      await waitForCondition(() => harness.streamEventHandlers.has("task-b2-perm"), 5000),
      "必须建立 task stream watcher",
    );
    await harness.streamEventHandlers.get("task-b2-perm")?.({
      type: "permission_request",
      taskId: "task-b2-perm",
      traceId: "run-b2-perm",
      requestId: "req-b2-perm",
      description: "Run bash command",
      kind: "bash",
      raw: null,
      options: [
        {
          optionId: "allow_once",
          kind: "allow_once",
          name: "Allow",
          response: { decision: "allow" },
        },
        {
          optionId: "reject_once",
          kind: "reject_once",
          name: "Deny",
          response: { decision: "deny", reason: "拒绝执行" },
        },
      ],
    });
    assert.ok(
      await waitForCondition(() => harness.stopGenerationCalls.length >= 1, 5000),
      "提示发送失败必须 stopGeneration（agent 停止，owner 决策 13）",
    );
    assert.deepEqual(harness.stopGenerationCalls, ["task-b2-perm"]);
    assert.ok(
      await waitForCondition(() => harness.respondPermissionCalls.length >= 1, 5000),
      "必须落 respondPermission deny-shaped 记录",
    );
    const deny = harness.respondPermissionCalls[0];
    assert.equal(deny?.requestId, "req-b2-perm");
    assert.equal(deny?.optionId, "reject_once", "必须复用 deny 选项的 optionId（/deny seam 同构）");
    assert.equal((deny?.response as { decision?: string })?.decision, "deny");
    const cleared = await waitForStateBotField(
      WEIXIN_BOT_ID,
      (entry) => (entry.pendingPermissionOptions === undefined ? "cleared" : undefined),
      5000,
    );
    assert.equal(cleared, "cleared", "pendingPermissionOptions 必须清除");
  } finally {
    await harness.dispose();
  }
});

// ---- 场景 12：feishu 同步卡片 ----

test("场景12（feishu 同步卡片）：card.action.trigger 回答处理失败 ⇒ 经既有 sync reply 返回失败卡片，handler 不 reject", async () => {
  const harness = await createCallbackHarness({
    provider: "feishu",
    respondElicitationFailures: 1,
    stateEntry: (botId, workspace) =>
      taskStateEntry(botId, workspace, {
        activeTaskId: "task-b2-feishu",
        pendingElicitation: pendingElicitationFixture({
          botId,
          provider: "feishu",
          providerUserId: "ou_inbound_1",
          taskId: "task-b2-feishu",
          requestId: "req-b2-feishu",
          questionCount: 1,
          currentQuestionIndex: 0,
        }),
      }),
  });
  try {
    // 手工构造 card.action.trigger（zcodeFeishuSynchronousCardAction 同步回执路径；
    // bot 配置不带 webhookSecretRef，跳过 token 校验）。
    const result = await harness.service.handleProviderCallbackResponse("feishu", {
      botId: FEISHU_BOT_ID,
      zcodeFeishuSynchronousCardAction: true,
      event: {
        event_id: "ev-fs-card-1",
        action: { value: { command: "red" } },
        operator: { operator_id: { open_id: "ou_inbound_1" } },
        context: { chat_type: "p2p", open_message_id: "om_fs_card_1" },
      },
    });
    assert.equal(
      result.ok,
      true,
      "回答失败但会话信号确认 ⇒ consumed ⇒ WS ACK 语义成立（onPayload 不 assert 即 handler 不 reject）",
    );
    assert.ok(
      result.replies[0]?.text.includes(NOTICE_MARKER),
      "失败结果必须经既有 sync reply（replies[0]）返回失败卡片",
    );
    const decline = harness.respondElicitationCalls.find((call) => call.action === "decline");
    assert.ok(decline, "B2 入站方向必须补 decline resolve");
    assert.equal(typeof decline?.content?.failureReason, "string");
    const entry = await readStateBotEntry(FEISHU_BOT_ID);
    assert.equal(entry.pendingElicitation, undefined);
  } finally {
    await harness.dispose();
  }
});

// ---- 场景 13：中段 elicitation（整组一次 resolve） ----

test("场景13（中段 elicitation）：3 题组在回答第 2 题时失败 ⇒ 整组恰好一次 decline+failureReason resolve（无逐题 resolve）", async () => {
  const harness = await createCallbackHarness({
    provider: "weixin",
    respondElicitationFailures: 1,
    stateEntry: (botId, workspace) =>
      taskStateEntry(botId, workspace, {
        activeTaskId: "task-b2-mid",
        isWeixin: true,
        // 3 题一组，正停在第 2 题（currentQuestionIndex=1）。
        pendingElicitation: pendingElicitationFixture({
          botId,
          provider: "weixin",
          providerUserId: "wx-user-1",
          taskId: "task-b2-mid",
          requestId: "req-b2-mid",
          questionCount: 3,
          currentQuestionIndex: 1,
        }),
      }),
  });
  try {
    // 结构化应答（webhook provider 同构回执）在第 2 题直达整组 submit；submit 失败
    // 即"回答第 2 题时失败"——submitPendingElicitation 一次 respondElicitation resolve
    // 整个 pending 组，逐题 resolve 机械上不存在。
    const result = await harness.service.handleProviderCallbackResponse("weixin", {
      botId: WEIXIN_BOT_ID,
      messages: [
        {
          id: "wx-msg-b2-mid-1",
          from: "wx-user-1",
          text: "structured-accept",
          elicitationResponse: { requestId: "req-b2-mid", action: "accept", content: {} },
        },
      ],
    });
    assert.equal(result.ok, true);
    const declineCalls = harness.respondElicitationCalls.filter(
      (call) => call.action === "decline",
    );
    assert.equal(
      declineCalls.length,
      1,
      "整组必须恰好一次 resolve（submitPendingElicitation 一次调用 resolve 全组，无逐题 resolve）",
    );
    assert.equal(declineCalls[0]?.requestId, "req-b2-mid");
    assert.equal(typeof declineCalls[0]?.content?.failureReason, "string");
    assert.equal(
      harness.respondElicitationCalls.length,
      2,
      "总共恰好两次调用：失败的 accept + 一次 decline 补偿",
    );
    const entry = await readStateBotEntry(WEIXIN_BOT_ID);
    assert.equal(entry.pendingElicitation, undefined, "整组 pending 清除");
  } finally {
    await harness.dispose();
  }
});
