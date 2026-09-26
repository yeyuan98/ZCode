/**
 * Playwright 测试夹具：mock provider 服务 + 隔离数据的真实 HTTP 服务器。
 *
 * 服务器以 tsx 子进程方式运行 e2e/serverBootstrap.ts（镜像 entry-http.ts 的装配），
 * 每个测试拿到独立的 HOME / ZCODE_DATA_BASE_DIR 临时目录，保证 provider、settings
 * 等状态互不泄漏；mock provider 服务实现 OpenAI 兼容的 GET /v1/models 供向导
 * “测试 API Key” 探测与自定义 provider 保存使用。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base } from "@playwright/test";

const e2eDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(e2eDir, "..");
/** 测试产物根目录（已加入 .gitignore）。 */
const artifactsRoot = join(e2eDir, ".playwright");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const bootstrapPath = join(e2eDir, "serverBootstrap.ts");
const webStaticRoot = join(repoRoot, "packages", "web", "dist");
const builtinConfigPath = join(repoRoot, "config", "provider", "zcode-builtin.json");

/** mock provider 只认这个 key；其余一律 401（探测失败路径）。 */
export const E2E_API_KEY = "e2e-key";
/** token 登录场景的服务器令牌。 */
export const E2E_SERVER_TOKEN = "e2e-server-token";
/** 注入内置配置的模板 id；探测与保存流程都用它定位 mock 端点。 */
export const MOCK_TEMPLATE_ID = "mock-e2e";

const READY_PREFIX = "E2E_SERVER_READY";
const SERVER_STARTUP_TIMEOUT_MS = 60_000;

interface MockProviderServer {
  readonly origin: string;
  readonly dispose: () => Promise<void>;
}

interface AppServer {
  readonly origin: string;
  readonly port: number;
  readonly dispose: () => Promise<void>;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolvePromise(typeof address === "object" && address ? address.port : 0);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise) => {
    server.close(() => {
      resolvePromise();
    });
  });
}

function handleMockProviderRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/v1/models") {
    // OpenAI 兼容模型列表：Bearer 鉴权，key 不匹配返回 401，供向导探测的失败断言使用。
    if (req.headers.authorization === `Bearer ${E2E_API_KEY}`) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "mock-e2e-model" }] }));
    } else {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
    }
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: "Not found" } }));
}

/** 启动 mock provider：向导“测试 API Key”探测会请求 {baseUrl}/v1/models。 */
async function startMockProviderServer(): Promise<MockProviderServer> {
  const server = createServer(handleMockProviderRequest);
  const port = await listen(server);
  return {
    origin: `http://127.0.0.1:${port}`,
    dispose: () => closeServer(server),
  };
}

/**
 * 基于仓库真实 zcode-builtin release 克隆一个指向 mock 服务的 api-key + openai 兼容模板。
 * 克隆现有模板（而非手写）保证 schema 形状始终与 release 校验一致。
 */
async function buildBuiltinConfigWithMockTemplate(mockOrigin: string): Promise<string> {
  const release: {
    config: {
      providerConfigRules: {
        templateRules: Array<{
          templateId: string;
          templateNameMap: Record<string, string>;
          config: {
            access?: { type?: string };
            api?: { type?: string };
            [key: string]: unknown;
          };
        }>;
      };
    };
  } = JSON.parse(await readFile(builtinConfigPath, "utf8"));
  const templateRules = release.config.providerConfigRules.templateRules;
  const seed = templateRules.find(
    (rule) =>
      rule.config.access?.type === "api-key" && rule.config.api?.type === "openai-chat-completions",
  );
  if (!seed) {
    throw new Error("zcode-builtin.json 中找不到可克隆的 api-key + openai 兼容模板");
  }
  const clone = structuredClone(seed);
  clone.templateId = MOCK_TEMPLATE_ID;
  clone.templateNameMap = { "zh-CN": "Mock E2E", "en-US": "Mock E2E" };
  clone.config = {
    ...clone.config,
    access: { type: "api-key" },
    api: { type: "openai-chat-completions", baseUrl: `${mockOrigin}/v1` },
    builtinModelIds: ["mock-e2e-model"],
  };
  templateRules.push(clone);
  return `${JSON.stringify(release)}\n`;
}

function waitForServerReady(child: ChildProcess): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`e2e 服务器 ${SERVER_STARTUP_TIMEOUT_MS}ms 内未就绪`)),
      SERVER_STARTUP_TIMEOUT_MS,
    );
    let stdoutBuffer = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith(READY_PREFIX)) {
          continue;
        }
        clearTimeout(timer);
        resolvePromise((JSON.parse(line.slice(READY_PREFIX.length)) as { port: number }).port);
        return;
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`e2e 服务器进程提前退出（exit ${code}）`));
    });
  });
}

interface StartAppServerOptions {
  readonly mockOrigin: string;
  readonly authToken?: string;
  readonly seedExistingUser?: boolean;
}

/**
 * 启动一台隔离数据的真实服务器（子进程 + tsx 加载仓库 TS 源码）。
 * - 每次调用生成独立 home/workspace 临时目录，测试之间无状态残留；
 * - ZCODE_ENDPOINT_ORIGIN 指向 mock 服务：阻断 builtin 配置的远端 CDN 刷新，
 *   防止真实远端 release 覆盖掉注入的 mock-e2e 模板。
 */
async function startAppServer(options: StartAppServerOptions): Promise<AppServer> {
  await mkdir(artifactsRoot, { recursive: true });
  const runDir = await mkdtemp(join(artifactsRoot, "run-"));
  const homeDir = join(runDir, "home");
  const workspaceDir = join(runDir, "workspace");
  await mkdir(homeDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(join(workspaceDir, "hello.txt"), "e2e workspace\n", "utf8");

  const builtinConfigPathForRun = join(runDir, "zcode-builtin.json");
  await writeFile(
    builtinConfigPathForRun,
    await buildBuiltinConfigWithMockTemplate(options.mockOrigin),
    "utf8",
  );

  const configPath = join(runDir, "server-config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      homeDir,
      workspaceDir,
      staticRoot: webStaticRoot,
      builtinConfigPath: builtinConfigPathForRun,
      ...(options.authToken ? { authToken: options.authToken } : {}),
      ...(options.seedExistingUser ? { seedExistingUser: true } : {}),
    }),
    "utf8",
  );

  const child = spawn(tsxBin, [bootstrapPath, configPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      ZCODE_DATA_BASE_DIR: homeDir,
      ZCODE_ENDPOINT_ORIGIN: options.mockOrigin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    process.stderr.write(`[e2e-server] ${chunk}`);
  });

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) {
      return;
    }
    disposed = true;
    await new Promise<void>((resolveDispose) => {
      child.once("exit", () => {
        resolveDispose();
      });
      child.kill("SIGTERM");
      setTimeout(() => {
        child.kill("SIGKILL");
      }, 5000).unref();
    });
    await rm(runDir, { recursive: true, force: true });
  };

  try {
    const port = await waitForServerReady(child);
    return { origin: `http://127.0.0.1:${port}`, port, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

type AppServerFixture = Awaited<ReturnType<typeof startAppServer>>;

/**
 * 两个 test 级 fixture：
 * - wizardApp：无 token 门禁的裸服务器（向导场景，每测全新的数据目录）；
 * - tokenApp：带 authToken 且预置“已跳过向导”的服务器（token 登录场景）。
 * mock provider 为 worker 级共享：无状态、只按 Authorization 头判定。
 */
export const test = base.extend<{
  mockProvider: MockProviderServer;
  wizardApp: AppServerFixture;
  tokenApp: AppServerFixture;
}>({
  mockProvider: [
    // Playwright 要求 fixture 工厂首参为对象解构；本 fixture 不依赖上游入参。
    // eslint-disable-next-line no-empty-pattern
    async ({}, run) => {
      const mockProvider = await startMockProviderServer();
      await run(mockProvider);
      await mockProvider.dispose();
    },
    { scope: "worker" },
  ],
  wizardApp: [
    async ({ mockProvider }, run) => {
      const app = await startAppServer({ mockOrigin: mockProvider.origin });
      await run(app);
      await app.dispose();
    },
    { scope: "test" },
  ],
  tokenApp: [
    async ({ mockProvider }, run) => {
      const app = await startAppServer({
        mockOrigin: mockProvider.origin,
        authToken: E2E_SERVER_TOKEN,
        seedExistingUser: true,
      });
      await run(app);
      await app.dispose();
    },
    { scope: "test" },
  ],
});
