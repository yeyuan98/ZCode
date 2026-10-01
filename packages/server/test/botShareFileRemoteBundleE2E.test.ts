import assert from "node:assert/strict";
import test from "node:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProxyChannel } from "@zcode/rpc";
import { connectRemote } from "@zcode/server/remote/connect.js";
import { createCloseEventController } from "@zcode/server/remote/closeEvent.js";
import type { IRemoteBackend, StdioStream } from "@zcode/server/remote/backend.js";
import {
  createBotsService,
  createDesktopBotShareFileForwardService,
  getAppConfigDir,
  setDataBaseDir,
} from "@zcode/services/node";
import { IBotShareFileForwardService, IBotWorkspaceFileService } from "@zcode/services";
import { ZCODE_AGENT_PROVIDER, type BotActor, type BotOutboundAttachment } from "@zcode/shared";

// 「全装彩排」E2E（specs/bot-file-delivery.md Phase C Alpha 4 的 CI 对策）：
// 生产两次出现「源码级测试全绿、rig 上 bundle 版部署后 share_file 返回
// unsupported-method」的部署形状失败（bundler/tree-shake/wiring 丢失只在 bundle 里
// 显形）。本测试不再导入 server 源码 internals，而是 exec 真实构建产物
// dist/remote/zcode-server.cjs，用真实 connectRemote + 真实桌面侧 forward channel +
// 真实 agent 协议（一个只说足够 ndjson 协议的假 Agent）把
//   spawn → zcode-hello 握手 → connect → AGENT 反向 bots/shareFile dispatch
//     → 远端→桌面 forward → 桌面单一写出核心 → 远端文件读取（真 channel 回读）
// 整条链跑通。任何一个环节在 bundle 里被 tree-shake/错配，测试都会以
// -32601 / unsupported-method / send-failed 的真实形态失败。
//
// 落位说明：放在 packages/server/test/ 是因为只有 server 包同时依赖
// @zcode/server（connectRemote + bundle 路径）与 @zcode/services/@zcode/rpc
// （桌面侧装配件），且其 test runner 已注册 TS loader。

const SERVER_PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REMOTE_SERVER_BUNDLE = join(SERVER_PKG_DIR, "dist", "remote", "zcode-server.cjs");
const BUNDLE_BUILD_TIMEOUT_MS = 300_000;
const E2E_PHASE_BUDGET_MS = 60_000;
const SERVER_READY_TIMEOUT_MS = 30_000;

const WEIXIN_BOT_ID = "bot-wx-bundle-e2e";
const TASK_ID = "task-bundle-e2e-1";
const REMOTE_WORKSPACE_IDENTITY = "bundle-e2e-remote-identity";
const SHARE_RELATIVE_PATH = "out/bundle-e2e-report.md";
const REMOTE_FILENAME = "bundle-e2e-report.md";
const REMOTE_PAYLOAD = Buffer.from(
  "zcode remote bundle e2e payload ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
);

const ACTOR: BotActor = {
  provider: "weixin",
  botId: WEIXIN_BOT_ID,
  providerUserId: "wx-user-bundle-e2e",
  chatType: "private",
  chatId: "wx-chat-bundle-e2e",
};

interface CapturedAttachment {
  botId: string;
  attachment: BotOutboundAttachment;
  localFileBytes: Buffer | null;
}

/**
 * BotTaskDeliveryRegistry 未从 services 公共入口导出（services 包内单测走源码深路径
 * 导入，server 包 exports map 不允许）。按同款语义本地实现：Map + 插入顺序淘汰
 * （上限对本测试无意义，单条目），why：只是让桌面 harness 能以对话式入站路径的
 * remember() 同形状登记投递目标。
 */
function createLocalTaskDeliveryRegistry() {
  const entries = new Map<
    string,
    { botId: string; actor: BotActor; workspacePath: string; workspaceIdentity?: string }
  >();
  return {
    get: (taskId: string) => entries.get(taskId),
    remember: (
      taskId: string,
      entry: { botId: string; actor: BotActor; workspacePath: string; workspaceIdentity?: string },
    ) => {
      entries.delete(taskId);
      entries.set(taskId, entry);
    },
    forget: (taskId: string) => {
      entries.delete(taskId);
    },
    clear: () => {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

/** 可观测 weixin adapter：只捕获 sendAttachment 事实（含调用时刻临时文件内容）。 */
function createCaptureAdapter(sink: CapturedAttachment[]) {
  return {
    test: async () => ({ ok: true, message: "stub" }),
    send: async () => undefined,
    sendAttachment: async (
      bot: { id: string },
      _message: unknown,
      attachment: BotOutboundAttachment,
    ) => {
      const localFileBytes = await readFile(attachment.localPath).then(
        (data) => data,
        () => null,
      );
      sink.push({ botId: bot.id, attachment, localFileBytes });
    },
  };
}

function buildWeixinBotConfig() {
  return {
    id: WEIXIN_BOT_ID,
    name: "Bundle E2E WeChat Bot",
    provider: "weixin",
    enabled: true,
    providerUserId: "wx-user-bundle-e2e",
    allowedWorkspaces: ["*"],
    // file 缺省视为允许（与 botShareFileRemoteTopology.test.ts 一致）。
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

/**
 * 假 Agent（真实进程、真实 zcode ndjson 协议）：
 * 1) 对 `session/list` 请求：先发反向请求 `bots/shareFile` {taskId, path}，等应答、
 *    把原始应答帧写入 outcome 文件，再回 `{sessions: []}` —— 保证桌面侧 listSessions
 *    resolve 时反向链路已有确定结局，测试时序无竞态；
 * 2) 对 `v4/bot-workspace-file/read`：把 payload 文件整块回传（远端文件读取腿走真
 *    channel、真协议，而不是桌面侧 stub reader）；
 * 3) 其余请求按旧 CLI 降级语义回 -32601。
 * 协议要点：帧边界只认 LF；请求/应答带数字或字符串 id；反向请求本身就是
 * {id, method, params} 形状 —— Host 侧 onRequest 分发不区分方向。
 */
function buildFakeAgentSource(): string {
  return [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "const REVERSE_ID = 'fake-agent-bots-share-file';",
    "let reverseWaiter = null;",
    "let buffer = '';",
    "function send(frame) { process.stdout.write(JSON.stringify(frame) + '\\n'); }",
    "async function handleFrame(frame) {",
    "  if (('result' in frame || 'error' in frame) && frame.id === REVERSE_ID) {",
    "    writeFileSync(process.env.FAKE_AGENT_OUTCOME_FILE, JSON.stringify(frame) + '\\n');",
    "    if (reverseWaiter) { const w = reverseWaiter; reverseWaiter = null; w(frame); }",
    "    return;",
    "  }",
    "  if (!('method' in frame) || !('id' in frame)) return;",
    "  if (frame.method === 'session/list') {",
    "    send({ id: REVERSE_ID, method: 'bots/shareFile', params: {",
    "      taskId: process.env.FAKE_AGENT_TASK_ID,",
    "      path: process.env.FAKE_AGENT_SHARE_PATH,",
    "    } });",
    "    await new Promise((resolve) => { reverseWaiter = resolve; });",
    "    send({ id: frame.id, result: { sessions: [] } });",
    "    return;",
    "  }",
    "  if (frame.method === 'v4/bot-workspace-file/read') {",
    "    const data = readFileSync(process.env.FAKE_AGENT_PAYLOAD_FILE);",
    "    send({ id: frame.id, result: {",
    "      ok: true,",
    "      filename: process.env.FAKE_AGENT_FILENAME,",
    "      sizeBytes: data.byteLength,",
    "      dataBase64: data.toString('base64'),",
    "      eof: true,",
    "    } });",
    "    return;",
    "  }",
    "  send({ id: frame.id, error: { code: -32601, message: 'fake agent: method not implemented: ' + frame.method } });",
    "}",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => {",
    "  buffer += chunk;",
    "  let idx;",
    "  while ((idx = buffer.indexOf('\\n')) !== -1) {",
    "    const line = buffer.slice(0, idx).trim();",
    "    buffer = buffer.slice(idx + 1);",
    "    if (line) { try { void handleFrame(JSON.parse(line)); } catch (error) { process.stderr.write('fake agent parse error: ' + error + '\\n'); } }",
    "  }",
    "});",
    "process.stdin.on('end', () => process.exit(0));",
  ].join("\n");
}

/** bundle 缺失时有界按需构建（CI 每次 run 最多构建一次；本地命中即跳过）。 */
async function ensureRemoteServerBundle(): Promise<void> {
  if (existsSync(REMOTE_SERVER_BUNDLE)) {
    return;
  }
  console.log(`[bundle-e2e] ${REMOTE_SERVER_BUNDLE} 缺失，按需执行 pnpm build:remote …`);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("pnpm", ["--dir", SERVER_PKG_DIR, "build:remote"], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectPromise(
        new Error(`按需构建 remote server bundle 超时（>${BUNDLE_BUILD_TIMEOUT_MS}ms）`),
      );
    }, BUNDLE_BUILD_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`pnpm --dir packages/server build:remote 退出码 ${code}`));
    });
  });
  if (!existsSync(REMOTE_SERVER_BUNDLE)) {
    throw new Error(
      `构建命令成功但产物仍缺失：${REMOTE_SERVER_BUNDLE}（请检查 packages/server/build-remote.ts 输出路径）`,
    );
  }
}

interface LocalPosixBackendOptions {
  tempHome: string;
  execEnv: Record<string, string>;
}

/**
 * 最小 IRemoteBackend stub：detect/exec/dispose 足矣（skipDeploy 跳过 upload/exists/
 * readFile）。exec 用 `/bin/sh -c <command>` 复刻 SSH 远端 shell 语义 —— connect.ts 的
 * buildRemoteServerCommand 硬编码 `~/.zcode/server/node ~/.zcode/server/zcode-server.cjs`
 * 与 env 前缀，`~` 展开依赖 shell 的 $HOME，因此必须在 TEMP HOME 里布好 node 符号链接
 * 与 bundle 副本，让「部署布局」与生产 SSH 远端同构。
 */
function createLocalPosixBackend(options: LocalPosixBackendOptions) {
  let child: ChildProcessWithoutNullStreams | undefined;
  let stderrTail = "";
  let stderrListeners: Array<(chunk: Buffer) => void> = [];
  return {
    backend: {
      detect: () => Promise.resolve({ platform: process.platform, arch: process.arch }),
      async exec(command: string): Promise<StdioStream> {
        child = spawn("/bin/sh", ["-c", command], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...options.execEnv, HOME: options.tempHome },
        });
        const closeEvent = createCloseEventController();
        let fired = false;
        const fireOnce = (code: number) => {
          if (fired) return;
          fired = true;
          closeEvent.fire(code);
        };
        child.once("exit", (code) => fireOnce(code ?? 0));
        child.once("close", (code) => fireOnce(code ?? 0));
        child.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          stderrTail = (stderrTail + text).slice(-4096);
          for (const listener of stderrListeners) listener(chunk);
        });
        return {
          stdin: child.stdin,
          stdout: child.stdout,
          stderr: child.stderr,
          onClose: closeEvent.event,
        };
      },
      upload: async () => {
        throw new Error("skipDeploy E2E 不应触达 backend.upload");
      },
      exists: async () => {
        throw new Error("skipDeploy E2E 不应触达 backend.exists");
      },
      readFile: async () => {
        throw new Error("skipDeploy E2E 不应触达 backend.readFile");
      },
      dispose: () => {
        child?.kill("SIGKILL");
      },
    } satisfies IRemoteBackend,
    /**
     * server 在 channel 注册完成、进入事件循环前会打 "stdio mode ready"（stderr）。
     * ChannelServer 对未注册 channel 的请求只缓冲 1s，桌面侧过早调用会拿到
     * "Unknown channel" 超时；等这行日志能把「服务初始化竞态」从被测链路里剔除。
     */
    waitForServerReady: (): Promise<void> => {
      return new Promise((resolvePromise, rejectPromise) => {
        const listener = (chunk: Buffer) => {
          if (chunk.toString("utf8").includes("stdio mode ready")) {
            cleanup();
            resolvePromise();
          }
        };
        if (stderrTail.includes("stdio mode ready")) {
          resolvePromise();
          return;
        }
        const timer = setTimeout(() => {
          cleanup();
          rejectPromise(
            new Error(
              `等待远端 server 就绪超时（${SERVER_READY_TIMEOUT_MS}ms）。stderr 尾部：${stderrTail}`,
            ),
          );
        }, SERVER_READY_TIMEOUT_MS);
        const cleanup = () => {
          clearTimeout(timer);
          stderrListeners = stderrListeners.filter((item) => item !== listener);
        };
        stderrListeners.push(listener);
      });
    },
    readStderrTail: () => stderrTail,
  };
}

interface ShareFileOutcomeFrame {
  id?: unknown;
  result?: {
    ok?: unknown;
    filename?: unknown;
    sizeBytes?: unknown;
    reason?: unknown;
    detail?: unknown;
  };
  error?: { code?: unknown; message?: unknown };
}

test(
  "全装彩排：真实构建的 remote server bundle 端到端投递 conversational share_file",
  { timeout: BUNDLE_BUILD_TIMEOUT_MS + 120_000 },
  async (t) => {
    if (process.platform === "win32") {
      t.skip("启动命令与 TEMP HOME 布局依赖 POSIX shell（/bin/sh -c、~ 展开），Windows 跳过");
      return;
    }
    await ensureRemoteServerBundle();

    const e2eStartedAt = Date.now();
    const workspaceParent = await mkdtemp(join(tmpdir(), "zcode-bundle-e2e-ws-"));
    const tempHome = await mkdtemp(join(tmpdir(), "zcode-bundle-e2e-home-"));
    const desktopDataRoot = await mkdtemp(join(tmpdir(), "zcode-bundle-e2e-desktop-"));
    // 远端 workspace（假 Agent 的 cwd / 注册表投递目标路径，对桌面侧不透明）。
    const remoteWorkspacePath = join(workspaceParent, "remote-project");
    const payloadFile = join(workspaceParent, "payload.md");
    const fakeAgentScript = join(workspaceParent, "fake-agent.mjs");
    const outcomeFile = join(workspaceParent, "share-file-outcome.ndjson");

    let connection: Awaited<ReturnType<typeof connectRemote>> | undefined;
    let desktopService: ReturnType<typeof createBotsService> | undefined;
    const desktopAdapterCalls: CapturedAttachment[] = [];

    try {
      // ---- 远端部署布局（与 SSH deploy 后的 ~/.zcode/server 同构）----
      await mkdir(join(tempHome, ".zcode", "server"), { recursive: true });
      await symlink(process.execPath, join(tempHome, ".zcode", "server", "node"), "file");
      await copyFile(REMOTE_SERVER_BUNDLE, join(tempHome, ".zcode", "server", "zcode-server.cjs"));
      await mkdir(remoteWorkspacePath, { recursive: true });
      await writeFile(payloadFile, REMOTE_PAYLOAD);
      await writeFile(fakeAgentScript, buildFakeAgentSource());

      // Agent 命令注入走生产链路本身：resolveDefaultZCodeAgentCommand 的 env 分支
      // （ZCODE_AGENT_SERVER_COMMAND/ARGS_JSON）是文档化的自定义命令机制，bundle 内
      // entry-stdio 无法注入测试用 zcodeAgentCommandResolver，env 覆盖反而覆盖了
      // 「真实 resolver 链」这一事实。fake agent 所需参数经 server 进程 env 透传。
      const backendHarness = createLocalPosixBackend({
        tempHome,
        execEnv: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          ZCODE_AGENT_SERVER_COMMAND: process.execPath,
          ZCODE_AGENT_SERVER_ARGS_JSON: JSON.stringify([fakeAgentScript, "app-server", "--stdio"]),
          FAKE_AGENT_TASK_ID: TASK_ID,
          FAKE_AGENT_SHARE_PATH: SHARE_RELATIVE_PATH,
          FAKE_AGENT_PAYLOAD_FILE: payloadFile,
          FAKE_AGENT_OUTCOME_FILE: outcomeFile,
          FAKE_AGENT_FILENAME: REMOTE_FILENAME,
        },
      });

      // ---- 桌面侧 harness：真实窗口 Host 装配件（botsService + forward channel）----
      setDataBaseDir(desktopDataRoot);
      const desktopConfigDir = getAppConfigDir();
      await mkdir(desktopConfigDir, { recursive: true });
      // 与 services 包内 bots config loader 的文件名/结构一致（BOTS_CONFIG_FILE 未公开导出）。
      await writeFile(
        join(desktopConfigDir, "bot-config.v3.json"),
        JSON.stringify({ version: 3, bots: [buildWeixinBotConfig()] }),
      );
      const taskDeliveryRegistry = createLocalTaskDeliveryRegistry();

      connection = await connectRemote(backendHarness.backend, {
        skipDeploy: true,
        // 生产只有桌面窗口 Host 传 true（web/http 模式不构造 desktop-serving
        // ChannelServer）；缺了它远端 forwarder 会折叠 unsupported-method —— 这正是
        // 本测试要钉住的生产语义。
        serveDesktopChannels: true,
        appVersion: "bundle-e2e-test",
        handshakeTimeout: 20_000,
      });
      assert.ok(
        connection.desktopChannelServer,
        "serveDesktopChannels=true 必须构造 desktopChannelServer",
      );

      await backendHarness.waitForServerReady();

      // 远端文件读取腿用真 channel 代理（生产 botRemoteRuntimeBridge 最终交给
      // botsService 的就是 IBotWorkspaceFileService 形状），不 stub 桌面侧 reader。
      const botWorkspaceFileProxy = ProxyChannel.toService<IBotWorkspaceFileService>(
        connection.client.getChannel(IBotWorkspaceFileService.channelName),
      );
      type BotsServiceDeps = Parameters<typeof createBotsService>[0];
      desktopService = createBotsService({
        credentialService: {
          load: async () => null,
        } as unknown as BotsServiceDeps["credentialService"],
        zcodeTaskService: {
          listDeletedTaskIds: async () => [],
        } as unknown as BotsServiceDeps["zcodeTaskService"],
        modelSelectionService: {
          getView: async () => ({
            revision: 1,
            providers: [],
            preferredSelection: { providerId: ZCODE_AGENT_PROVIDER, modelId: "glm-test" },
            effectiveSelection: { providerId: ZCODE_AGENT_PROVIDER, modelId: "glm-test" },
          }),
        },
        runStartupBackgroundTasks: false,
        providerOverrides: { weixin: createCaptureAdapter(desktopAdapterCalls) },
        taskDeliveryRegistry,
        remoteWorkspaceService: {
          isConnected: async () => false,
          ensureConnected: async () => ({ ok: true }),
          getWorkspaceFileReader: async () => botWorkspaceFileProxy,
        },
      });

      // 与生产 window Host 相同的注册点（desktop/src/host/index.ts）：远端→桌面反向
      // channel 上注册窄化 forward handler，作用域钉扎由桌面事实决定。
      connection.desktopChannelServer.registerChannel(
        IBotShareFileForwardService.channelName,
        ProxyChannel.fromService(
          createDesktopBotShareFileForwardService({
            botsService: desktopService,
            resolveWorkspaceScopes: () => [
              { workspacePath: remoteWorkspacePath, workspaceIdentity: REMOTE_WORKSPACE_IDENTITY },
            ],
          }),
        ),
      );

      // 模拟对话式入站已登记投递目标（botFileDelivery.test.ts 单独钉住入站链，此处
      // 只预置注册表事实，与生产 remember() 同形状）。
      taskDeliveryRegistry.remember(TASK_ID, {
        botId: WEIXIN_BOT_ID,
        actor: ACTOR,
        workspacePath: remoteWorkspacePath,
        workspaceIdentity: REMOTE_WORKSPACE_IDENTITY,
      });

      // ---- 触发 AGENT-PROTOCOL dispatch 腿：真实 v4 只读方法让 bundle spawn 假 Agent ----
      // listSessions → getReadOnlyClient(start-if-needed) → 真实 spawn（env resolver）→
      // server 发 session/list；假 Agent 收到后先发 bots/shareFile 反向请求并等结局。
      const sessions = await connection.services.zcodeAgentService.listSessions({
        workspacePath: remoteWorkspacePath,
        workspaceIdentity: REMOTE_WORKSPACE_IDENTITY,
      });
      assert.deepEqual(sessions, []);

      // ---- 断言 1：假 Agent 侧拿到的必须是 ok 结果，且绝不是 -32601/unsupported-method ----
      const outcomeRaw = await readFile(outcomeFile, "utf8");
      const outcome = JSON.parse(outcomeRaw.trim()) as ShareFileOutcomeFrame;
      if (outcome.error) {
        // 负向钉子：bundle 内 executor/forwarder wiring 被 tree-shake 或装配错配时，
        // 这里会是 -32601 "bots/shareFile is unavailable on this host"（Chain X-a）或
        // forwarder 折叠的 unsupported-method（Chain Y）；两者都必须在此显形。
        assert.fail(
          `bots/shareFile 反向请求被远端 bundle 以协议错误拒绝：code=${String(outcome.error.code)} message=${String(outcome.error.message)}` +
            `（-32601 = bundle 内 wiring 丢失；server stderr 尾部：${backendHarness.readStderrTail()}）`,
        );
      }
      assert.ok(outcome.result, "反向请求应答必须携带 result");
      assert.equal(
        outcome.result.ok,
        true,
        `share_file 结局必须是 ok，实际 ${JSON.stringify(outcome.result)}`,
      );
      assert.equal(outcome.result.filename, REMOTE_FILENAME);
      assert.equal(outcome.result.sizeBytes, REMOTE_PAYLOAD.length);

      // ---- 断言 2：桌面侧恰好一次投递，字节与假 Agent 回传的远端文件一致 ----
      assert.equal(desktopAdapterCalls.length, 1, "桌面单一写出核心必须恰好投递一次");
      const delivery = desktopAdapterCalls[0];
      assert.equal(delivery.botId, WEIXIN_BOT_ID);
      assert.ok(delivery.localFileBytes, "sendAttachment 执行时临时文件必须存在");
      assert.deepEqual(delivery.localFileBytes, REMOTE_PAYLOAD);
      assert.equal(delivery.attachment.sizeBytes, REMOTE_PAYLOAD.length);

      const e2eElapsedMs = Date.now() - e2eStartedAt;
      assert.ok(
        e2eElapsedMs < E2E_PHASE_BUDGET_MS,
        `E2E 阶段耗时 ${e2eElapsedMs}ms 超出预算 ${E2E_PHASE_BUDGET_MS}ms`,
      );
      console.log(`[bundle-e2e] 全链路耗时 ${e2eElapsedMs}ms（不含 bundle 构建）`);
    } finally {
      if (connection) {
        await connection.disposeAndWait({ timeoutMs: 8_000 }).catch(() => undefined);
      }
      if (desktopService) {
        await desktopService.disposeAllAndWait().catch(() => undefined);
      }
      setDataBaseDir(null);
      await rm(workspaceParent, { recursive: true, force: true }).catch(() => undefined);
      await rm(tempHome, { recursive: true, force: true }).catch(() => undefined);
      await rm(desktopDataRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  },
);
