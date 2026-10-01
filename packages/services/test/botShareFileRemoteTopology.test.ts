import assert from "node:assert/strict";
import test from "node:test";
import {
  ZCODE_AGENT_PROVIDER,
  zcodeBotsShareFileParamsSchema,
  type BotActor,
  type BotOutboundAttachment,
  type BotShareFileResult,
} from "@zcode/shared";
import { ChannelClient, ChannelServer, Event, ProxyChannel, createQueuePair } from "@zcode/rpc";
import { BOTS_CONFIG_FILE } from "../src/bots/config.js";
import {
  createBotTaskDeliveryRegistry,
  createBotsService,
  type BotTaskDeliveryRegistry,
} from "../src/bots/botsService.js";
import {
  createBotShareFileForwarder,
  createBotsShareFileExecutor,
  createDesktopBotShareFileForwardService,
  IBotShareFileForwardService,
} from "../src/bots/botShareFileForwardService.js";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";
import type { IBotsService } from "../src/bots/bots.js";
import type { IZCodeTaskService } from "../src/session/zcodeTaskService.js";
import type { ICredentialService } from "../src/credential/credential.js";
import type { IModelSelectionService } from "../src/model-provider/providerFacadeServices.js";
import type { BotProviderAdapter } from "../src/bots/providers/types.js";
import type { V4BotWorkspaceFileReadResult } from "@zcode/shared/zcode-protocol-v4";
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// specs/bot-file-delivery.md Phase C Alpha 3：跨 Host 收件人解析（远端→桌面 forward）。
//
// Phase 1 复现结论（已裁定）：远端 zcode-server（desktop-attached-remote 装配）用自己的
// 空 taskDeliveryRegistry 自答 share_file，恒 no-target；桌面窗口 Host 的注册表才有
// 投递事实。Phase 2 修复：远端装配的 botsShareFileExecutor 经同一 stdio 连接上的窄化
// 反向 channel（IBotShareFileForwardService）把 {taskId, path} 交回桌面单一写出核心，
// 桌面侧按连接作用域做 workspace 钉扎。
//
// 本文件用「真实生产件」搭拓扑：A = 真实 createBotsService 桌面实例（注册表 + Alpha-2
// 远端取回桥 + adapter 捕获）；B = 真实第二个实例（standalone/本地裁决替身，注册表恒空）；
// channel 两侧 = 真实 ChannelServer/ChannelClient（createQueuePair 内存对）+ 真实
// createDesktopBotShareFileForwardService / createBotShareFileForwarder /
// createBotsShareFileExecutor。唯一 stub 是远端文件 reader 与 provider adapter。

const TOPO_WEIXIN_BOT_ID = "bot-wx-topo";
const TOPO_TASK_ID = "task-remote-topo-1";
// 远端机器上的 workspace 路径：对 A 只是不透明投递目标（远端分支不做本地 resolve）。
const TOPO_REMOTE_WORKSPACE_PATH = "/srv/zcode/remote-project";
const TOPO_REMOTE_IDENTITY = "remote-identity-topo";
const TOPO_RELATIVE_PATH = "out/remote-report.md";
const TOPO_REMOTE_FILENAME = "remote-report.md";
const TOPO_REMOTE_PAYLOAD = Buffer.from("zcode remote topology reproduction payload 0123456789");

const TOPO_ACTOR: BotActor = {
  provider: "weixin",
  botId: TOPO_WEIXIN_BOT_ID,
  providerUserId: "wx-user-topo",
  chatType: "private",
  chatId: "wx-chat-topo",
};

type BotsServiceLike = IBotsService & { disposeAllAndWait(): Promise<void> };

/** 与 node.ts 注入 zcodeAgentService 的 executor 形状一致。 */
type BotsShareFileExecutor = (params: {
  taskId: string;
  path: string;
}) => Promise<BotShareFileResult>;

interface CapturedAttachment {
  botId: string;
  attachment: BotOutboundAttachment;
  /** 调用时刻 localPath 的真实内容（不存在 → null）。 */
  localFileBytes: Buffer | null;
}

interface RemoteReadCall {
  workspacePath: string;
  workspaceIdentity: string;
  relativePath: string;
  offset: number;
  limit: number;
}

/** 结构对齐 IBotWorkspaceFileService 的最小 fake（桥接 Alpha-2 远端取回，单一整块回传）。 */
interface FakeRemoteWorkspaceFileReader {
  readWorkspaceFile(params: {
    workspacePath: string;
    workspaceIdentity: string;
    relativePath: string;
    offset: number;
    limit: number;
  }): Promise<V4BotWorkspaceFileReadResult>;
}

function createSingleShotRemoteReader(options: {
  filename: string;
  content: Buffer;
  calls: RemoteReadCall[];
}): FakeRemoteWorkspaceFileReader {
  return {
    async readWorkspaceFile(params) {
      options.calls.push({ ...params });
      return {
        ok: true as const,
        filename: options.filename,
        sizeBytes: options.content.length,
        dataBase64: options.content.toString("base64"),
        eof: true,
      };
    },
  };
}

/** 可观测 adapter：只捕获 sendAttachment 事实（含调用时刻临时文件内容），不产生副作用。 */
function createCaptureAdapter(sink: CapturedAttachment[]): BotProviderAdapter {
  return {
    test: async () => ({ ok: true, message: "stub" }),
    send: async () => undefined,
    sendAttachment: async (bot, _message, attachment) => {
      const localFileBytes = await readFile(attachment.localPath).then(
        (data) => data,
        () => null,
      );
      sink.push({ botId: bot.id, attachment, localFileBytes });
    },
  };
}

function buildTopologyWeixinBotConfig() {
  return {
    id: TOPO_WEIXIN_BOT_ID,
    name: "Topology WeChat Bot",
    provider: "weixin",
    enabled: true,
    providerUserId: "wx-user-topo",
    allowedWorkspaces: ["*"],
    // file 缺省视为允许（与 botFileDelivery.test.ts 的 baseAllowedCommands 一致）。
    allowedCommands: {
      status: true,
      new: true,
      workspace: true,
      model: true,
      thoughtLevel: true,
      reply: true,
    },
    currentOptions: {},
    replyMode: "assistant_changes",
  };
}

interface RemoteTopologyHarness {
  /** A：窗口宿主 desktop-local botsService（注册表由对话式入站路径写入；唯一投递事实源）。 */
  desktopService: BotsServiceLike;
  desktopRegistry: BotTaskDeliveryRegistry;
  desktopAdapterCalls: CapturedAttachment[];
  /** B：本地裁决替身（standalone-server / desktop-local 的语义代表），注册表恒空。 */
  standaloneService: BotsServiceLike;
  standaloneRegistry: BotTaskDeliveryRegistry;
  standaloneAdapterCalls: CapturedAttachment[];
  remoteReaderCalls: RemoteReadCall[];
  /**
   * 桌面侧连接作用域（可变，调用时刻读取——对应生产中 registry 按 target 实时筛出的
   * 在线 logical session workspace 集合）。
   */
  connectionScopes: Array<{ workspacePath: string; workspaceIdentity?: string }>;
  /** node.ts desktop-attached-remote 装配的真实 executor（forward，绝不本地自答）。 */
  productionExecutor: BotsShareFileExecutor;
  /** node.ts 其余装配（standalone / desktop-local）的真实 executor（本地裁决语义不变）。 */
  standaloneExecutor: BotsShareFileExecutor;
  /** 反向 channel 就绪（桌面 ChannelServer 构造即回 Initialize，内存对上异步送达）。 */
  waitForDesktopChannelReady(): Promise<void>;
  /**
   * 复刻 zcodeAgentService.ts bots/shareFile handler：strict schema 校验 → executor →
   * 结果原样回传（-32602/-32601 分支不在本测试射程）。
   */
  dispatchReverseRpc(
    executor: BotsShareFileExecutor,
    params: { taskId: string; path: string },
  ): Promise<BotShareFileResult>;
  /**
   * 以 botsService.ts:5668-5673 对话式入站路径的 remember() 同形状，直接登记
   * A 的远程 workspace 投递目标（入站 → 注册表写入已由 botFileDelivery.test.ts
   * 「对话式入站消息填充 taskDeliveryRegistry」单独钉住，此处不重复整条入站链）。
   */
  rememberDesktopDeliveryTarget(): void;
  dispose(): Promise<void>;
}

async function createRemoteTopologyHarness(): Promise<RemoteTopologyHarness> {
  // ---- A 机器（桌面本地）data 根：持有微信 bot 配置 ----
  const desktopDataRoot = await mkdtemp(join(tmpdir(), "zcode-topo-desktop-"));
  setDataBaseDir(desktopDataRoot);
  const desktopConfigDir = getAppConfigDir();
  await mkdir(desktopConfigDir, { recursive: true });
  await writeFile(
    join(desktopConfigDir, BOTS_CONFIG_FILE),
    JSON.stringify({ version: 3, bots: [buildTopologyWeixinBotConfig()] }),
  );

  const desktopRegistry = createBotTaskDeliveryRegistry();
  const desktopAdapterCalls: CapturedAttachment[] = [];
  const remoteReaderCalls: RemoteReadCall[] = [];
  const reader = createSingleShotRemoteReader({
    filename: TOPO_REMOTE_FILENAME,
    content: TOPO_REMOTE_PAYLOAD,
    calls: remoteReaderCalls,
  });

  // shareFileForTask 路径不触达 task/model 服务；占位 fake 仅为满足装配依赖形状。
  const credentialService = { load: async () => null } as unknown as ICredentialService;
  const unusedTaskService = {
    listDeletedTaskIds: async () => [] as string[],
  } as unknown as IZCodeTaskService;
  const modelSelection = { providerId: ZCODE_AGENT_PROVIDER, modelId: "glm-test" };
  const modelSelectionService = {
    getView: async () => ({
      revision: 1,
      providers: [],
      preferredSelection: modelSelection,
      effectiveSelection: modelSelection,
    }),
  } as unknown as Pick<IModelSelectionService, "getView">;

  // ---- 实例 A：窗口宿主 desktop-local botsService ----
  // remoteWorkspaceService 桥接 Alpha-2 远端取回（getWorkspaceFileReader → fake reader）。
  // isConnected 如实返回 false：tool 路径不咨询 isConnected（与 botFileDelivery.test.ts
  // 「远程 tool happy path」一致——只有 /file 命令路径有断连拦截）。
  const desktopService = createBotsService({
    credentialService,
    zcodeTaskService: unusedTaskService,
    modelSelectionService,
    runStartupBackgroundTasks: false,
    providerOverrides: { weixin: createCaptureAdapter(desktopAdapterCalls) },
    taskDeliveryRegistry: desktopRegistry,
    remoteWorkspaceService: {
      isConnected: async () => false,
      ensureConnected: async () => ({ ok: true }),
      getWorkspaceFileReader: async () => reader,
    },
  });

  // ---- 实例 B：本地裁决替身（standalone-server / desktop-local 语义代表）----
  // 自有 data 根、自有空注册表：生产中 standalone server 也不接收 bot 入站，
  // 其本地裁决 no-target 语义按 spec Alpha 3 §5 明确保留。
  const standaloneDataRoot = await mkdtemp(join(tmpdir(), "zcode-topo-standalone-"));
  setDataBaseDir(standaloneDataRoot);
  const standaloneRegistry = createBotTaskDeliveryRegistry();
  const standaloneAdapterCalls: CapturedAttachment[] = [];
  const standaloneService = createBotsService({
    credentialService,
    zcodeTaskService: unusedTaskService,
    modelSelectionService,
    runStartupBackgroundTasks: false,
    providerOverrides: { weixin: createCaptureAdapter(standaloneAdapterCalls) },
    taskDeliveryRegistry: standaloneRegistry,
  });
  setDataBaseDir(desktopDataRoot);

  // ---- 反向 channel 拓扑：真实 ChannelServer/ChannelClient（内存 protocol 对）----
  const connectionScopes: Array<{ workspacePath: string; workspaceIdentity?: string }> = [];
  const [desktopProtocol, remoteProtocol] = createQueuePair();
  // 先挂 client 与就绪等待，再构造桌面 server（构造即发 Initialize，异步送达）。
  const remoteChannelClient = new ChannelClient(remoteProtocol);
  const desktopChannelReady = Event.toPromise(remoteChannelClient.onDidInitialize);
  const desktopChannelServer = new ChannelServer(desktopProtocol, "desktop");
  // 真实桌面 forward handler：严格 schema + 连接作用域钉扎 → A 的单一写出核心。
  desktopChannelServer.registerChannel(
    IBotShareFileForwardService.channelName,
    ProxyChannel.fromService(
      createDesktopBotShareFileForwardService({
        botsService: desktopService,
        resolveWorkspaceScopes: () => connectionScopes,
      }),
    ),
  );
  // 真实远端 forwarder（失败矩阵折叠：旧桌面 unsupported-method / 传输错误与子超时
  // send-failed / 回包不合法 send-failed）。
  const forwarder = createBotShareFileForwarder(remoteChannelClient);
  // 真实装配裁决（与 node.ts 同款）：desktop-attached-remote → forward；
  // 其余装配 → 本地单写者裁决（fail-closed no-target 语义保留）。
  const productionExecutor = createBotsShareFileExecutor({
    forwarder,
    resolveLocalBotsService: () => standaloneService,
  });
  const standaloneExecutor = createBotsShareFileExecutor({
    resolveLocalBotsService: () => standaloneService,
  });

  return {
    desktopService,
    desktopRegistry,
    desktopAdapterCalls,
    standaloneService,
    standaloneRegistry,
    standaloneAdapterCalls,
    remoteReaderCalls,
    connectionScopes,
    productionExecutor,
    standaloneExecutor,
    waitForDesktopChannelReady: () => desktopChannelReady,
    async dispatchReverseRpc(executor, params) {
      const parsed = zcodeBotsShareFileParamsSchema.safeParse(params);
      if (!parsed.success) {
        throw new Error("Invalid bots shareFile params (-32602)");
      }
      return executor({ taskId: parsed.data.taskId, path: parsed.data.path });
    },
    rememberDesktopDeliveryTarget() {
      desktopRegistry.remember(TOPO_TASK_ID, {
        botId: TOPO_WEIXIN_BOT_ID,
        actor: TOPO_ACTOR,
        workspacePath: TOPO_REMOTE_WORKSPACE_PATH,
        workspaceIdentity: TOPO_REMOTE_IDENTITY,
      });
    },
    async dispose() {
      desktopChannelServer.dispose();
      remoteChannelClient.dispose();
      await Promise.all([
        desktopService.disposeAllAndWait().catch(() => undefined),
        standaloneService.disposeAllAndWait().catch(() => undefined),
      ]);
      setDataBaseDir(null);
      await rm(desktopDataRoot, { recursive: true, force: true });
      await rm(standaloneDataRoot, { recursive: true, force: true });
    },
  };
}

test("生产装配翻转：远程 executor 经反向 channel forward 到桌面单一写出核心 → ok；本地裁决装配仍 no-target", async () => {
  const harness = await createRemoteTopologyHarness();
  try {
    // 前提事实：A 的注册表以对话式入站路径（botsService.ts:5668）的 remember 形状登记了
    // 远程 workspace 投递目标；B 的注册表恒空（它从不接收 bot 入站）。
    harness.rememberDesktopDeliveryTarget();
    assert.ok(harness.desktopRegistry.get(TOPO_TASK_ID));
    assert.equal(harness.standaloneRegistry.size, 0);
    // 桌面连接作用域 = 本连接 target 上的在线 logical session workspace 集合。
    harness.connectionScopes.push({
      workspacePath: TOPO_REMOTE_WORKSPACE_PATH,
      workspaceIdentity: TOPO_REMOTE_IDENTITY,
    });
    await harness.waitForDesktopChannelReady();

    // ---- 翻转后的生产路径：真实 executor（forward）→ 桌面真实 handler → A 真实投递 ----
    const forwarded = await harness.dispatchReverseRpc(harness.productionExecutor, {
      taskId: TOPO_TASK_ID,
      path: TOPO_RELATIVE_PATH,
    });
    assert.deepEqual(forwarded, {
      ok: true,
      filename: TOPO_REMOTE_FILENAME,
      sizeBytes: TOPO_REMOTE_PAYLOAD.length,
    });
    // 恰好一次投递，发生在桌面实例的 adapter；B 的 adapter 零调用。
    assert.equal(harness.desktopAdapterCalls.length, 1);
    assert.equal(harness.standaloneAdapterCalls.length, 0);
    const call = harness.desktopAdapterCalls[0];
    assert.ok(call.localFileBytes, "sendAttachment 执行时临时文件必须存在");
    assert.deepEqual(call.localFileBytes, TOPO_REMOTE_PAYLOAD);

    // ---- 对照（真实装配语义保留）：standalone/desktop-local 的本地裁决仍 no-target。
    // 同一参数，唯一差异是请求终结在哪个装配——这是 Phase 1 复现结论的另一半：
    // 「本地裁决」语义本身没有 bug，错的是远程装配用它自答。
    const localResolved = await harness.dispatchReverseRpc(harness.standaloneExecutor, {
      taskId: TOPO_TASK_ID,
      path: TOPO_RELATIVE_PATH,
    });
    assert.deepEqual(localResolved, { ok: false, reason: "no-target" });
    assert.equal(harness.desktopAdapterCalls.length, 1);
    assert.equal(harness.standaloneAdapterCalls.length, 0);
  } finally {
    await harness.dispose();
  }
});

test("身份钉扎：注册表条目 workspace 不在连接作用域内 / 作用域为空 → not-allowed，零投递", async () => {
  const harness = await createRemoteTopologyHarness();
  try {
    harness.rememberDesktopDeliveryTarget();
    await harness.waitForDesktopChannelReady();

    // 1) 作用域指向「别的 workspace」：被入侵的远端不能借本连接投递别的会话。
    harness.connectionScopes.push({
      workspacePath: "/srv/zcode/other-project",
      workspaceIdentity: "remote-identity-other",
    });
    const mismatched = await harness.dispatchReverseRpc(harness.productionExecutor, {
      taskId: TOPO_TASK_ID,
      path: TOPO_RELATIVE_PATH,
    });
    assert.deepEqual(mismatched, { ok: false, reason: "not-allowed" });
    assert.equal(harness.desktopAdapterCalls.length, 0);
    // reader 也不得被触碰（钉扎先于任何文件 IO 与配额）。
    assert.equal(harness.remoteReaderCalls.length, 0);

    // 2) 作用域为空（本 target 无在线 logical session）：fail-closed。
    harness.connectionScopes.length = 0;
    const emptyScope = await harness.dispatchReverseRpc(harness.productionExecutor, {
      taskId: TOPO_TASK_ID,
      path: TOPO_RELATIVE_PATH,
    });
    assert.deepEqual(emptyScope, { ok: false, reason: "not-allowed" });
    assert.equal(harness.desktopAdapterCalls.length, 0);

    // 3) 作用域修正为桌面事实后（动态读取，非快照），同一 forward 恢复 ok——
    //    证明 not-allowed 来自钉扎判定而非其他投递前置条件。
    harness.connectionScopes.push({
      workspacePath: TOPO_REMOTE_WORKSPACE_PATH,
      workspaceIdentity: TOPO_REMOTE_IDENTITY,
    });
    const recovered = await harness.dispatchReverseRpc(harness.productionExecutor, {
      taskId: TOPO_TASK_ID,
      path: TOPO_RELATIVE_PATH,
    });
    assert.deepEqual(recovered, {
      ok: true,
      filename: TOPO_REMOTE_FILENAME,
      sizeBytes: TOPO_REMOTE_PAYLOAD.length,
    });
    assert.equal(harness.desktopAdapterCalls.length, 1);
  } finally {
    await harness.dispose();
  }
});

test("旧桌面（无反向 channel）：forward 立即折叠 unsupported-method，不排队、零投递", async () => {
  const harness = await createRemoteTopologyHarness();
  try {
    harness.rememberDesktopDeliveryTarget();
    // 旧桌面不构造 desktop-serving ChannelServer：远端 client 永远收不到 Initialize。
    // 用一个「从未有桌面 server」的独立 protocol 对 + 真实 forwarder 复刻该组合。
    const [, orphanProtocol] = createQueuePair();
    const orphanClient = new ChannelClient(orphanProtocol);
    const orphanForwarder = createBotShareFileForwarder(orphanClient);
    const orphanExecutor = createBotsShareFileExecutor({
      forwarder: orphanForwarder,
      resolveLocalBotsService: () => harness.standaloneService,
    });
    const result = await harness.dispatchReverseRpc(orphanExecutor, {
      taskId: TOPO_TASK_ID,
      path: TOPO_RELATIVE_PATH,
    });
    // 与旧 host 的 -32601 → unsupported-method 语义一致：CLI 渲染既有能力差异散文，
    // 绝不挂满 280s 预算，也绝不误报 no-target。
    assert.deepEqual(result, { ok: false, reason: "unsupported-method" });
    assert.equal(harness.desktopAdapterCalls.length, 0);
    assert.equal(harness.standaloneAdapterCalls.length, 0);
    orphanClient.dispose();
  } finally {
    await harness.dispose();
  }
});

test("forward 失败矩阵：桌面 handler 抛错 / 子超时 / 回包不合法 → send-failed（带 detail）", async () => {
  // 失败映射是远端 forwarder 的职责：桌面 handler 用受控 stub 触发三种失败形态，
  // channel 与 forwarder 均为真实生产件。每个场景独立一对内存 protocol。
  const forwardTimeoutMs = 40;

  async function withDesktopHandler(
    handlerService: IBotShareFileForwardService,
  ): Promise<BotShareFileResult> {
    const [desktopProtocol, remoteProtocol] = createQueuePair();
    const remoteClient = new ChannelClient(remoteProtocol);
    // 就绪等待先于 server 构造挂上（server 构造即发 Initialize，内存对上异步送达）。
    const ready = Event.toPromise(remoteClient.onDidInitialize);
    const server = new ChannelServer(desktopProtocol, "desktop");
    server.registerChannel(
      IBotShareFileForwardService.channelName,
      ProxyChannel.fromService(handlerService),
    );
    const forwarder = createBotShareFileForwarder(remoteClient, { timeoutMs: forwardTimeoutMs });
    await ready;
    const result = await forwarder({ taskId: "task-x", path: "out/x.bin" });
    server.dispose();
    remoteClient.dispose();
    return result;
  }

  // 1) 桌面 handler 抛错 → PromiseError → send-failed。
  const thrown = await withDesktopHandler({
    forward: async () => {
      throw new Error("desktop handler exploded");
    },
  });
  assert.equal(thrown.ok, false);
  if (!thrown.ok) {
    assert.equal(thrown.reason, "send-failed");
    assert.match(thrown.detail ?? "", /desktop handler exploded/);
  }

  // 2) 子超时（handler 延迟超过注入的 timeoutMs）→ send-failed（而非挂起或 unknown-outcome）。
  const delayed = await withDesktopHandler({
    forward: async () => {
      await new Promise((resolve) => setTimeout(resolve, forwardTimeoutMs * 4));
      return { ok: true, filename: "late.bin", sizeBytes: 1 };
    },
  });
  assert.equal(delayed.ok, false);
  if (!delayed.ok) {
    assert.equal(delayed.reason, "send-failed");
    assert.match(delayed.detail ?? "", /timed out/);
  }

  // 3) 桌面回包不合法（reason 不在枚举内）→ 严格结果 schema 拒绝 → send-failed。
  const invalid = await withDesktopHandler({
    // 故意绕过类型：模拟被篡改/不合法的桌面回包。
    forward: async () => ({ ok: false, reason: "bogus-reason" }) as unknown as BotShareFileResult,
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.reason, "send-failed");
  }
});

test("控制组不对称性：A 直接应答恰好一次投递，桥接目标与注册表条目一致，临时文件清理", async () => {
  const harness = await createRemoteTopologyHarness();
  try {
    harness.rememberDesktopDeliveryTarget();
    const result = await harness.desktopService.shareFileForTask({
      taskId: TOPO_TASK_ID,
      path: TOPO_RELATIVE_PATH,
    });
    assert.deepEqual(result, {
      ok: true,
      filename: TOPO_REMOTE_FILENAME,
      sizeBytes: TOPO_REMOTE_PAYLOAD.length,
    });
    // 恰好一次投递，且调用时刻临时文件存在、内容与远端 reader 回传逐字节一致。
    assert.equal(harness.desktopAdapterCalls.length, 1);
    const call = harness.desktopAdapterCalls[0];
    assert.ok(call.localFileBytes, "sendAttachment 执行时临时文件必须存在");
    assert.deepEqual(call.localFileBytes, TOPO_REMOTE_PAYLOAD);
    assert.equal(call.attachment.sizeBytes, TOPO_REMOTE_PAYLOAD.length);
    assert.ok(
      call.attachment.localPath.startsWith(join(tmpdir(), "zcode-bot-outbound")),
      `temp path should live under tmpdir/zcode-bot-outbound: ${call.attachment.localPath}`,
    );
    // 桥接收到的目标与 A 注册表条目逐字段一致（identity/path 透传，非本地 resolve）。
    assert.equal(harness.remoteReaderCalls.length, 1);
    assert.equal(harness.remoteReaderCalls[0].workspacePath, TOPO_REMOTE_WORKSPACE_PATH);
    assert.equal(harness.remoteReaderCalls[0].workspaceIdentity, TOPO_REMOTE_IDENTITY);
    assert.equal(harness.remoteReaderCalls[0].relativePath, TOPO_RELATIVE_PATH);
    assert.equal(harness.remoteReaderCalls[0].offset, 0);
    // 投递后临时文件被清理。
    await assert.rejects(stat(call.attachment.localPath), /ENOENT/);
    // B 侧零事实：本测试从头到尾没问过 B。
    assert.equal(harness.standaloneAdapterCalls.length, 0);
    assert.equal(harness.standaloneRegistry.size, 0);
  } finally {
    await harness.dispose();
  }
});
