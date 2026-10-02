import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IDisposable } from "@zcode/rpc";
import type { BotActor, BotConfig, BotInboundAttachment, BotInboundMessage } from "@zcode/shared";
import { ZCODE_AGENT_PROVIDER, type ZCodeAutomationBotDeliveryTarget } from "@zcode/shared";
import { createBotProviderRequester } from "../src/bots/providers/providerRequest.js";
import {
  encodeWeixinMediaAesKey,
  encryptWeixinCdnMediaForTest,
} from "../src/bots/providers/weixinProvider.js";
import { createBotsService } from "../src/bots/botsService.js";
import { BOTS_CONFIG_FILE, BOTS_STATE_FILE } from "../src/bots/config.js";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";
import type { IBotsService } from "../src/bots/bots.js";
import type { IZCodeTaskService } from "../src/session/zcodeTaskService.js";
import type { ICredentialService } from "../src/credential/credential.js";
import type { IModelSelectionService } from "../src/model-provider/providerFacadeServices.js";

// specs/bot-provider-network.md F1 验收场景 1-4、10：bot provider 全部出站 HTTP 走注入
// requester（providerFetch 组合缝）；缺省回落 globalThis.fetch 零漂移；transport 销毁
// fail-closed 不回退直连。全程 stub 注入 fetch / global fetch，无真实网络。

interface CapturedFetchCall {
  url: string;
  init: RequestInit | undefined;
}

type FetchRouter = (call: CapturedFetchCall) => Response | Promise<Response>;

function jsonResponse(payload: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** 捕获型 fetch stub：记录全部调用并按 URL 路由应答。 */
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

// ---- 场景 1：requester 工厂单元 ----

test("requester 工厂：三个 helper 全部使用注入的 fetch", async () => {
  const recorder = createRecordingFetch(() => jsonResponse({ ok: true, answer: 42 }));
  const requester = createBotProviderRequester(recorder.fetch);

  const plain = await requester.fetchBotProvider("https://bot.example/plain");
  assert.deepEqual(plain, { ok: true, status: 200 });

  const json = await requester.fetchBotProviderJson<{ answer: number }>("https://bot.example/json");
  assert.equal(json.payload?.answer, 42);
  assert.equal(json.responseLogId, undefined);

  const withHeaders = await requester.fetchBotProviderWithHeaders("https://bot.example/headers");
  assert.equal(withHeaders.ok, true);
  assert.equal(withHeaders.headers["content-type"], "application/json");

  // 三个 helper 各命中注入 fetch 一次；deadline 信号由 requester 统一接线。
  assert.deepEqual(
    recorder.calls.map((call) => call.url),
    ["https://bot.example/plain", "https://bot.example/json", "https://bot.example/headers"],
  );
  for (const call of recorder.calls) {
    assert.ok(call.init?.signal instanceof AbortSignal);
  }
});

test("requester 工厂：缺省构造使用 globalThis.fetch（身份路由）", async () => {
  const recorder = createRecordingFetch(() => jsonResponse({ ok: true }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = recorder.fetch;
  try {
    // 缺省参数在构造时捕获 globalThis.fetch——stub 安装后构造即走 stub。
    const requester = createBotProviderRequester();
    await requester.fetchBotProvider("https://bot.example/default");
    await requester.fetchBotProviderJson("https://bot.example/default-json");
    assert.equal(recorder.calls.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---- 服务级路由覆盖（场景 2）：createBotsService + providerFetch，无 providerOverrides ----

const TELEGRAM_TOKEN = "tg-token-net-1";
const WEIXIN_TOKEN = "wx-token-net-1";
const FEISHU_APP_ID = "cli_9000000000000001";
const FEISHU_SECRET = "feishu-app-secret-net-1";
const WEBHOOK_SECRET = "wh-secret-net-1";
const CONVERSATIONAL_TASK_ID = "task-net-conv-1";

const TELEGRAM_FILE_BYTES = Buffer.from(
  "telegram inbound file payload (network transport)",
  "utf8",
);
const WEIXIN_FILE_PLAINTEXT = Buffer.from("weixin inbound cdn payload (network transport)", "utf8");
const WEIXIN_AES_KEY_HEX = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
const FEISHU_FILE_BYTES = Buffer.from(
  "feishu inbound resource payload (network transport)",
  "utf8",
);

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

interface ServiceHarness {
  service: IBotsService;
  calls: CapturedFetchCall[];
  sendPromptCalls: Array<{ taskId: string }>;
  dataRoot: string;
  workspace: string;
  dispose(): Promise<void>;
}

interface ServiceHarnessOptions {
  bots: Array<Partial<BotConfig> & { id: string; provider: BotConfig["provider"] }>;
  providerFetch?: typeof globalThis.fetch;
  /** 显式不注入 providerFetch（缺省组合回落 globalThis.fetch，场景 3）。 */
  omitProviderFetch?: boolean;
  runStartupBackgroundTasks?: boolean;
  getUpdatesAfterFirstHang?: boolean;
}

/**
 * 真实 provider 装配的服务级 harness：临时 data 目录 + 配置/状态落盘 +
 * 全端点 fetch 路由 stub。不传 providerOverrides——出站全部走真实 adapter，
 * 用于证明 providerFetch 注入覆盖所有原裸 fetch 出口。
 */
async function createServiceHarness(options: ServiceHarnessOptions): Promise<ServiceHarness> {
  const dataRoot = await mkdtemp(join(tmpdir(), "zcode-bot-net-"));
  setDataBaseDir(dataRoot);
  const workspace = await mkdtemp(join(tmpdir(), "zcode-bot-net-ws-"));
  await writeFile(join(workspace, "out.txt"), "hello");
  const configDir = getAppConfigDir();
  await mkdir(configDir, { recursive: true });

  const botDefaults = {
    enabled: true,
    allowedWorkspaces: ["*"],
    allowedCommands: baseAllowedCommands(),
    currentOptions: {},
    replyMode: "assistant_changes",
  };
  const bots = options.bots.map((bot) => ({
    name: bot.id,
    providerUserId: "net-user-1",
    ...botDefaults,
    ...bot,
  }));
  await writeFile(join(configDir, BOTS_CONFIG_FILE), JSON.stringify({ version: 3, bots }));

  const stateBots: Record<string, unknown> = {};
  for (const bot of options.bots) {
    stateBots[bot.id] = {
      botId: bot.id,
      workspacePath: workspace,
      mode: "task",
      activeTaskId: CONVERSATIONAL_TASK_ID,
      ...(bot.provider === "weixin" ? { weixinActivatedAt: 1 } : {}),
      updatedAt: 1,
    };
  }
  await writeFile(
    join(configDir, BOTS_STATE_FILE),
    JSON.stringify({ version: 3, bots: stateBots }),
  );

  let getUpdatesCount = 0;
  const router: FetchRouter = (call) => {
    const url = call.url;
    if (url.startsWith("https://api.telegram.org/file/bot")) {
      return new Response(new Uint8Array(TELEGRAM_FILE_BYTES));
    }
    if (url.startsWith("https://api.telegram.org/bot")) {
      if (url.endsWith("/getFile")) {
        return jsonResponse({
          ok: true,
          result: { file_path: "docs/report.txt", file_size: TELEGRAM_FILE_BYTES.length },
        });
      }
      if (url.endsWith("/getUpdates")) {
        getUpdatesCount += 1;
        if (options.getUpdatesAfterFirstHang && getUpdatesCount > 1) {
          // 首轮空结果后挂起第二次长轮询，等待 runtime dispose 的 abort 收口。
          return new Promise<Response>((_, reject) => {
            call.init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
        }
        return jsonResponse({ ok: true, result: [] });
      }
      return jsonResponse({ ok: true });
    }
    if (url.startsWith("https://ilinkai.weixin.qq.com/")) {
      return jsonResponse({ ret: 0, errcode: 0 });
    }
    if (url === "https://cdn.example.weixin.net/c2c/weixin-file") {
      const ciphertext = encryptWeixinCdnMediaForTest(WEIXIN_FILE_PLAINTEXT, WEIXIN_AES_KEY_HEX);
      return new Response(new Uint8Array(ciphertext));
    }
    if (url.startsWith("https://open.feishu.cn/")) {
      if (url.includes("/auth/v3/tenant_access_token/internal")) {
        return jsonResponse({ code: 0, tenant_access_token: "t-net-feishu", expire: 7200 });
      }
      if (url.includes("/messages/") && url.includes("/resources/")) {
        return new Response(new Uint8Array(FEISHU_FILE_BYTES));
      }
      return jsonResponse({ code: 0, data: { message_id: "om-net-1" } });
    }
    if (url === "https://hooks.example.net/wh") {
      return jsonResponse({ received: true });
    }
    throw new Error(`unexpected bot egress url: ${url}`);
  };

  const recorder = createRecordingFetch(router);
  const sendPromptCalls: Array<{ taskId: string }> = [];
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
      botDeliveryTarget?: ZCodeAutomationBotDeliveryTarget;
    }) => {
      sendPromptCalls.push({ taskId: request.taskId });
    },
    setMode: async () => undefined,
    onDynamicStreamEvent: () => (): IDisposable => ({ dispose: () => undefined }),
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
  const credentialValues: Record<string, string> = {
    "telegram-token-ref": TELEGRAM_TOKEN,
    "weixin-token-ref": WEIXIN_TOKEN,
    [`feishu-secret-${FEISHU_APP_ID}`]: FEISHU_SECRET,
    "webhook-secret-ref": WEBHOOK_SECRET,
  };
  const credentialService = {
    load: async (key: string) => credentialValues[key] ?? null,
  } as unknown as ICredentialService;

  const service = createBotsService({
    credentialService,
    zcodeTaskService: fakeTaskService as unknown as IZCodeTaskService,
    modelSelectionService,
    ...(options.runStartupBackgroundTasks === false ? { runStartupBackgroundTasks: false } : {}),
    // 显式传入才注入；不传时服务缺省回落 globalThis.fetch（场景 3 零漂移组合）。
    ...(!options.omitProviderFetch
      ? { providerFetch: options.providerFetch ?? recorder.fetch }
      : {}),
  });

  return {
    service,
    calls: recorder.calls,
    sendPromptCalls,
    dataRoot,
    workspace,
    async dispose() {
      await service.disposeAllAndWait().catch(() => undefined);
      setDataBaseDir(null);
      await rm(dataRoot, { recursive: true, force: true });
      await rm(workspace, { recursive: true, force: true });
    },
  };
}

function buildInbound(
  provider: BotActor["provider"],
  botId: string,
  attachments: BotInboundAttachment[],
): BotInboundMessage {
  return {
    botId,
    text: "继续分析",
    attachments,
    receivedAt: Date.now(),
    actor: {
      provider,
      botId,
      providerUserId: "net-user-1",
      chatType: "private",
      chatId: `${provider}-chat-1`,
      providerMessageId: `msg-${provider}-1`,
    },
  };
}

test("场景2：telegram getFile + 文件下载走注入 providerFetch（原裸 fetch 站点 ~548/~562）", async () => {
  const harness = await createServiceHarness({
    runStartupBackgroundTasks: false,
    bots: [
      {
        id: "bot-telegram-net",
        provider: "telegram",
        credentialRef: "telegram-token-ref",
      },
    ],
  });
  try {
    await harness.service.handleInboundMessage(
      buildInbound("telegram", "bot-telegram-net", [
        {
          id: "tg-file-1",
          kind: "file",
          filename: "report.txt",
          mimeType: "text/plain",
          providerFileId: "tg-file-id-1",
          sizeBytes: TELEGRAM_FILE_BYTES.length,
        },
      ]),
    );
    const urls = harness.calls.map((call) => call.url);
    assert.ok(
      urls.some((url) => url === `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile`),
      "getFile 必须走注入 fetch",
    );
    assert.ok(
      urls.some(
        (url) => url === `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/docs/report.txt`,
      ),
      "文件下载必须走注入 fetch",
    );
    assert.ok(harness.sendPromptCalls.length >= 1, "附件解析后继续投递任务");
  } finally {
    await harness.dispose();
  }
});

test("场景2：weixin CDN 下载走注入 providerFetch（原裸 fetch 站点 ~1086）", async () => {
  const harness = await createServiceHarness({
    runStartupBackgroundTasks: false,
    bots: [
      {
        id: "bot-weixin-net",
        provider: "weixin",
        credentialRef: "weixin-token-ref",
      },
    ],
  });
  try {
    await harness.service.handleInboundMessage(
      buildInbound("weixin", "bot-weixin-net", [
        {
          id: "wx-file-1",
          kind: "file",
          filename: "report.txt",
          mimeType: "text/plain",
          downloadUrl: "https://cdn.example.weixin.net/c2c/weixin-file",
          providerMetadata: { weixinAesKey: encodeWeixinMediaAesKey(WEIXIN_AES_KEY_HEX) },
        },
      ]),
    );
    const cdnCall = harness.calls.find(
      (call) => call.url === "https://cdn.example.weixin.net/c2c/weixin-file",
    );
    assert.ok(cdnCall, "微信 CDN 下载必须走注入 fetch");
    assert.ok(harness.sendPromptCalls.length >= 1, "CDN 解密成功后继续投递任务");
  } finally {
    await harness.dispose();
  }
});

test("场景2：feishu 资源下载走注入 providerFetch（原裸 fetch 站点 ~2009）", async () => {
  const harness = await createServiceHarness({
    runStartupBackgroundTasks: false,
    bots: [
      {
        id: "bot-feishu-net",
        provider: "feishu",
        feishuAppId: FEISHU_APP_ID,
        credentialRef: `feishu-secret-${FEISHU_APP_ID}`,
      },
    ],
  });
  try {
    await harness.service.handleInboundMessage(
      buildInbound("feishu", "bot-feishu-net", [
        {
          id: "fs-file-1",
          kind: "file",
          filename: "report.pdf",
          mimeType: "application/pdf",
          providerFileId: "file_v2_net_1",
        },
      ]),
    );
    const resourceCall = harness.calls.find((call) =>
      call.url.includes("/open-apis/im/v1/messages/msg-feishu-1/resources/file_v2_net_1"),
    );
    assert.ok(resourceCall, "飞书资源下载必须走注入 fetch");
    assert.match(resourceCall.url, /type=file/u);
    assert.ok(harness.sendPromptCalls.length >= 1, "资源下载成功后继续投递任务");
  } finally {
    await harness.dispose();
  }
});

test("场景2：webhook 出站走注入 providerFetch（原裸 fetch 站点 ~116）", async () => {
  const harness = await createServiceHarness({
    runStartupBackgroundTasks: false,
    bots: [
      {
        id: "bot-webhook-net",
        provider: "webhook",
        webhookUrl: "https://hooks.example.net/wh",
        webhookSecretRef: "webhook-secret-ref",
      },
    ],
  });
  try {
    const result = await harness.service.testBot("bot-webhook-net");
    assert.equal(result.ok, true, result.message);
    const webhookCall = harness.calls.find((call) => call.url === "https://hooks.example.net/wh");
    assert.ok(webhookCall, "webhook 出站必须走注入 fetch");
    const body = JSON.parse(String(webhookCall.init?.body)) as { type: string; botId: string };
    assert.equal(body.type, "zcode.bot.test");
    const headers = (webhookCall.init?.headers ?? {}) as Record<string, string>;
    assert.equal(headers["x-zcode-bot-secret"], WEBHOOK_SECRET);
  } finally {
    await harness.dispose();
  }
});

test("场景2：telegram deleteWebhook + getUpdates 长轮询走注入 providerFetch（telegramChannelRuntime）", async () => {
  const harness = await createServiceHarness({
    // 后台轮询必须真实启动（构造即 refresh）。
    runStartupBackgroundTasks: true,
    getUpdatesAfterFirstHang: true,
    bots: [
      {
        id: "bot-telegram-poll",
        provider: "telegram",
        credentialRef: "telegram-token-ref",
      },
    ],
  });
  try {
    const deadline = Date.now() + 10_000;
    while (
      Date.now() < deadline &&
      !(
        harness.calls.some((call) => call.url.endsWith("/deleteWebhook")) &&
        harness.calls.some((call) => call.url.endsWith("/getUpdates"))
      )
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const urls = harness.calls.map((call) => call.url);
    assert.ok(
      urls.some((url) => url === `https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteWebhook`),
      "deleteWebhook 必须走注入 fetch",
    );
    assert.ok(
      urls.some((url) => url === `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`),
      "getUpdates 长轮询必须走注入 fetch",
    );
    // 命令菜单同步同样经由注入出口（bonus：setMyCommands 路由覆盖）。
    assert.ok(urls.some((url) => url.endsWith("/setMyCommands")));
  } finally {
    // 第二轮 getUpdates 挂起中：dispose 必须 abort 并等待轮询退出。
    await harness.dispose();
  }
});

// ---- 场景 3 + 10：无代理组合零漂移 ----

test("场景3/10：未传 providerFetch 时回落 globalThis.fetch（零漂移）", async () => {
  // 复用路由 stub，但替换 globalThis.fetch 而不是注入 providerFetch。
  const router: FetchRouter = (call) => {
    if (call.url.startsWith("https://api.telegram.org/file/bot")) {
      return new Response(new Uint8Array(TELEGRAM_FILE_BYTES));
    }
    if (call.url.endsWith("/getFile")) {
      return jsonResponse({
        ok: true,
        result: { file_path: "docs/report.txt", file_size: TELEGRAM_FILE_BYTES.length },
      });
    }
    return jsonResponse({ ok: true });
  };
  const recorder = createRecordingFetch(router);
  const realFetch = globalThis.fetch;
  globalThis.fetch = recorder.fetch;
  let harness: ServiceHarness | undefined;
  try {
    harness = await createServiceHarness({
      runStartupBackgroundTasks: false,
      bots: [
        {
          id: "bot-telegram-default",
          provider: "telegram",
          credentialRef: "telegram-token-ref",
        },
      ],
      // 不注入 providerFetch：requester 缺省捕获 globalThis.fetch（此刻是 stub），
      // 服务出站与 alpha.5 直连行为零漂移。
      omitProviderFetch: true,
    });
    await harness.service.handleInboundMessage(
      buildInbound("telegram", "bot-telegram-default", [
        {
          id: "tg-file-1",
          kind: "file",
          filename: "report.txt",
          mimeType: "text/plain",
          providerFileId: "tg-file-id-1",
          sizeBytes: TELEGRAM_FILE_BYTES.length,
        },
      ]),
    );
    const urls = recorder.calls.map((call) => call.url);
    assert.ok(
      urls.some((url) => url.endsWith("/getFile")),
      "缺省组合走 globalThis.fetch",
    );
    assert.ok(
      urls.some((url) => url.endsWith("/docs/report.txt")),
      "缺省组合文件下载走 globalThis.fetch",
    );
    assert.ok(harness.sendPromptCalls.length >= 1);
  } finally {
    globalThis.fetch = realFetch;
    await harness?.dispose();
  }
});

// ---- 场景 4：transport 销毁 fail-closed ----

test("场景4：providerFetch 销毁后请求失败且绝不回退 globalThis.fetch", async () => {
  const disposedError = "Host API network transport has been disposed";
  const realFetch = globalThis.fetch;
  let globalFallbackCalls = 0;
  // 间谍 global fetch：若发生直连回退会计数（任何调用都判定失败）。
  globalThis.fetch = (async () => {
    globalFallbackCalls += 1;
    return jsonResponse({ ok: true });
  }) as typeof globalThis.fetch;
  let harness: ServiceHarness | undefined;
  try {
    harness = await createServiceHarness({
      runStartupBackgroundTasks: false,
      bots: [
        {
          id: "bot-webhook-disposed",
          provider: "webhook",
          webhookUrl: "https://hooks.example.net/wh",
          webhookSecretRef: "webhook-secret-ref",
        },
      ],
      providerFetch: (async () => {
        throw new Error(disposedError);
      }) as typeof globalThis.fetch,
    });
    // webhook provider 的 test 出站必须以 transport 的结构化错误失败，
    // 重试 3 次后上抛；期间不允许任何直连回退。
    await assert.rejects(
      harness.service.testBot("bot-webhook-disposed"),
      new RegExp(disposedError, "u"),
    );
    assert.equal(globalFallbackCalls, 0, "fail-closed：销毁后不得回退 globalThis.fetch");
  } finally {
    globalThis.fetch = realFetch;
    await harness?.dispose();
  }
});
