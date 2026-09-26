/**
 * E2E 专用 HTTP 服务器引导（子进程）。
 *
 * 由 e2e/fixtures.ts 通过 tsx 拉起，装配方式镜像 packages/server/src/entry-http.ts
 * （materializeZCodeBuiltinProviderConfig → createLocalServices → createHttpServer），
 * 差异只有三点：
 * 1. 监听 127.0.0.1 随机端口，端口通过 stdout 单行 JSON（E2E_SERVER_READY）回传给 fixture；
 * 2. 内置 provider 配置内容可注入（fixture 预置指向 mock 服务的 `mock-e2e` 模板）；
 * 3. 用户数据完全隔离：HOME 与 ZCODE_DATA_BASE_DIR 都指向本次运行的临时目录。
 */
import { readFile } from "node:fs/promises";

interface E2eServerBootstrapConfig {
  /** 隔离用户目录：同时作为 HOME 与 ZCODE_DATA_BASE_DIR（setting.json 在 $HOME/.zcode 下，其余数据在 dataBaseDir/.zcode 下）。 */
  readonly homeDir: string;
  /** server-info 暴露给 Web 首开的工作区目录。 */
  readonly workspaceDir: string;
  /** Web 静态资源根（packages/web/dist）。 */
  readonly staticRoot: string;
  /** 已注入 mock 模板的 zcode-builtin release JSON 文件路径。 */
  readonly builtinConfigPath: string;
  /** 设置后启用 token 门禁（token 登录场景）。 */
  readonly authToken?: string;
  /** 设置后通过真实 settingService 写入“存量用户”状态（已跳过 provider 向导 + 已完成职业引导）。 */
  readonly seedExistingUser?: boolean;
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath) {
    throw new Error("usage: tsx e2e/serverBootstrap.ts <config.json>");
  }
  const config: E2eServerBootstrapConfig = JSON.parse(await readFile(configPath, "utf8"));

  // 数据目录隔离（关键）：packages/services/src/paths.ts 在模块加载时读取 ZCODE_DATA_BASE_DIR，
  // 因此必须在动态 import 任何 services 模块之前写回 process.env；HOME 同步指向隔离目录，
  // 因为 settingService / 凭据存储按 $HOME/.zcode 解析，否则会污染真实用户数据。
  process.env.ZCODE_DATA_BASE_DIR = config.homeDir;
  process.env.HOME = config.homeDir;
  process.env.USERPROFILE = config.homeDir;
  // 工作区通过 env 传给 http.ts 的 resolveServerWorkspaces（优先级高于 cwd）。
  process.env.ZCODE_SERVER_WORKSPACE = config.workspaceDir;

  const { createLocalServices, getAppConfigDir, materializeZCodeBuiltinProviderConfig } =
    await import("../packages/services/src/node.js");
  const { ISettingService } = await import("../packages/services/src/setting/setting.js");
  const { IOnboardingRecordService } =
    await import("../packages/services/src/onboarding/onboardingRecord.js");
  const { createHttpServer } = await import("../packages/server/src/http.js");

  const zcodeBuiltinProviderConfigFilePath = await materializeZCodeBuiltinProviderConfig({
    environmentConfigRoot: getAppConfigDir(),
    content: await readFile(config.builtinConfigPath, "utf8"),
  });
  const services = createLocalServices({
    zcodeBuiltinProviderConfigFilePath,
    providerProvisioningTargetEnabled: Boolean(config.authToken),
  });

  if (config.seedExistingUser) {
    // 走真实服务写入存量用户状态，而不是手写 settings/record 文件：
    // settings 加载是宽松 zod 解析，手写文件一旦 schema 不匹配会被静默重置，测试就会失真。
    // providerOnboardingDismissedAt 让启动门禁不再弹向导；onboardingOccupation +
    // 引导记录 dismiss 决策跳过职业首跑引导（触发判定只看记录文件，不看 settings），
    // 三者合起来才是“登录后直达应用外壳”的老用户。
    await services.get(ISettingService).update({
      providerOnboardingDismissedAt: new Date().toISOString(),
      onboardingOccupation: "developer",
    });
    await services.get(IOnboardingRecordService).dismissOnboarding("e2e-seeded-device");
  }

  const server = createHttpServer(services, 0, {
    host: "127.0.0.1",
    staticRoot: config.staticRoot,
    spaFallback: true,
    ...(config.authToken ? { authToken: config.authToken, authRequired: true } : {}),
  });
  // serve() 返回时可能尚未触发 listening事件，address() 还是 null；
  // 等待真正监听后才能拿到随机端口。
  if (!server.listening) {
    await new Promise<void>((resolveListening) => {
      server.once("listening", () => {
        resolveListening();
      });
    });
  }
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  // 就绪协议：单行前缀 + JSON，fixture 逐行扫描 stdout 解析真实监听端口。
  process.stdout.write(`E2E_SERVER_READY ${JSON.stringify({ port })}\n`);

  process.on("SIGTERM", () => {
    // 尽力释放服务（关闭 sqlite 句柄等），让 fixture 能干净删除临时目录；失败不阻塞退出。
    try {
      services.disposeAll();
    } catch {
      // 退出路径上的清理失败无需处理
    }
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => {
      process.exit(0);
    }, 1500).unref();
  });
}

await main().catch((error: unknown) => {
  process.stderr.write(`[e2e-server-bootstrap] startup failed: ${String(error)}\n`);
  process.exit(1);
});
