import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BotActor, BotOutboundMessage } from "@zcode/shared";
import { ZCODE_AGENT_PROVIDER } from "@zcode/shared";
import { BOTS_CONFIG_FILE, BOTS_STATE_FILE } from "../src/bots/config.js";
import { createBotsService } from "../src/bots/botsService.js";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";
import type { IBotsService } from "../src/bots/bots.js";
import type { IZCodeTaskService } from "../src/session/zcodeTaskService.js";
import type { ICredentialService } from "../src/credential/credential.js";
import type { IModelSelectionService } from "../src/model-provider/providerFacadeServices.js";
import type { ISettingService } from "../src/setting/setting.js";
import type { BotProviderAdapter } from "../src/bots/providers/types.js";

// specs/bot-file-delivery.md Phase C Alpha 5 验收场景 7：/help 终于列出 /file
// （自 Alpha 0 起延迟至今）。钉住三点：zh/en 双语目录都有该行；
// allowedCommands.file === false 时隐藏；telegram 原生命令菜单的行为在
// botFileDeliveryTelegram.test.ts 里锁定（syncCommands → setMyCommands）。

const WEIXIN_BOT_ID = "bot-wx";

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

interface HelpHarnessOptions {
  /** 注入 app settings 的 locale（缺省不注入 settingService → 服务回退 zh-CN）。 */
  locale?: "zh-CN" | "en-US";
  /** 显式 false 时 /file 行必须从 /help 输出中隐藏。 */
  fileAllowed?: boolean;
}

interface HelpHarness {
  service: IBotsService & { disposeAllAndWait(): Promise<void> };
  sendHelp(text?: string): Promise<BotOutboundMessage[]>;
  dispose(): Promise<void>;
}

async function createHelpHarness(options: HelpHarnessOptions = {}): Promise<HelpHarness> {
  const dataRoot = await mkdtemp(join(tmpdir(), "zcode-bot-help-"));
  setDataBaseDir(dataRoot);
  const workspace = await mkdtemp(join(tmpdir(), "zcode-bot-help-ws-"));
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
            ...baseAllowedCommands(),
            ...(options.fileAllowed === false ? { file: false } : {}),
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
          mode: "task",
          activeTaskId: null,
          updatedAt: 1,
        },
      },
    }),
  );

  // /help 不触发出站网络；weixin adapter 覆盖为惰性 stub，与 botFileDelivery.test.ts 同款。
  const weixinAdapter: BotProviderAdapter = {
    test: async () => ({ ok: true, message: "stub" }),
    send: async () => undefined,
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
    sendPrompt: async () => undefined,
    setMode: async () => undefined,
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
  const settingService =
    options.locale === undefined
      ? undefined
      : ({
          get: async () => ({ locale: options.locale }),
          update: async () => undefined,
        } as unknown as ISettingService);

  const service = createBotsService({
    credentialService: { load: async () => null } as unknown as ICredentialService,
    zcodeTaskService: fakeTaskService as unknown as IZCodeTaskService,
    modelSelectionService,
    ...(settingService ? { settingService } : {}),
    runStartupBackgroundTasks: false,
    providerOverrides: { weixin: weixinAdapter },
  });

  const actor: BotActor = {
    provider: "weixin",
    botId: WEIXIN_BOT_ID,
    providerUserId: "wx-user-1",
    chatType: "private",
    chatId: "wx-chat-1",
  };

  return {
    service,
    async sendHelp(text = "/帮助") {
      const replies = await service.handleInboundMessage({
        botId: WEIXIN_BOT_ID,
        actor,
        text,
        receivedAt: Date.now(),
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
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

test("/help 默认（zh）输出包含 /file 行", async () => {
  const harness = await createHelpHarness();
  try {
    const replies = await harness.sendHelp("/帮助");
    assert.equal(replies.length, 1);
    const text = replies[0].text;
    assert.match(text, /\*\*\/file <路径>\*\* — 发送工作区内的文件（仅私聊，≤5MB）/u);
    // 菜单顺序：file 位于策略命令（reply）之后、bind 之前。
    const fileIndex = text.indexOf("**/file <路径>**");
    const replyIndex = text.indexOf("**/回复**");
    const bindIndex = text.indexOf("**/bind <code>**");
    assert.ok(fileIndex > replyIndex && fileIndex < bindIndex, `unexpected order: ${text}`);
  } finally {
    await harness.dispose();
  }
});

test("/help en-US 输出包含 /file 行", async () => {
  const harness = await createHelpHarness({ locale: "en-US" });
  try {
    const replies = await harness.sendHelp("/help");
    assert.equal(replies.length, 1);
    assert.match(
      replies[0].text,
      /\*\*\/file <path>\*\* — Send a workspace file \(private chat only, max 5MB\)/u,
    );
  } finally {
    await harness.dispose();
  }
});

test("allowedCommands.file: false → /help 输出隐藏 /file 行（zh + en）", async () => {
  const zhHarness = await createHelpHarness({ fileAllowed: false });
  try {
    const replies = await zhHarness.sendHelp("/帮助");
    assert.equal(replies.length, 1);
    assert.ok(!replies[0].text.includes("/file"), `file line must be hidden: ${replies[0].text}`);
    // 其余命令不受影响。
    assert.ok(replies[0].text.includes("**/回复**"));
  } finally {
    await zhHarness.dispose();
  }
  const enHarness = await createHelpHarness({ fileAllowed: false, locale: "en-US" });
  try {
    const replies = await enHarness.sendHelp("/help");
    assert.equal(replies.length, 1);
    assert.ok(!replies[0].text.includes("/file"), `file line must be hidden: ${replies[0].text}`);
    assert.ok(replies[0].text.includes("**/reply**"));
  } finally {
    await enHarness.dispose();
  }
});
