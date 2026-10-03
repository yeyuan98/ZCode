import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BotConfig } from "@zcode/shared";
import { ZCODE_AGENT_PROVIDER } from "@zcode/shared";
import { createBotsService } from "../src/bots/botsService.js";
import { createPollErrorBackoff } from "../src/bots/channelRuntime.js";
import { BOTS_CONFIG_FILE, BOTS_STATE_FILE } from "../src/bots/config.js";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";
import type { IBotsService } from "../src/bots/bots.js";
import type { IZCodeTaskService } from "../src/session/zcodeTaskService.js";
import type { ICredentialService } from "../src/credential/credential.js";
import type { IModelSelectionService } from "../src/model-provider/providerFacadeServices.js";

// specs/bot-inbound-resilience.md §D（3.14.5-alpha.3，Worker D）：轮询错误 backoff 递增。
// 场景 10：纯状态机序列 5/10/20/40/60/60 + 成功复位（无 timer，同步单测）。
// 另附 telegram 轮询级接线断言（botProviderNetwork 场景 5/8 的 scripted /getupdates 模式）：
// 失败 poll 的 warn 行 nextMs 递增、成功周期后复位到 5s；409/lock 等待不进状态的边界由
// 纯单元 + 源码审查钉住（409 专属 10s 等待真实时钟过慢，不为它建重型 harness）。

// ---- 场景 10：纯状态机（无 timer） ----

test("场景10：createPollErrorBackoff 连续 6 次 nextDelayMs ⇒ 5/10/20/40/60/60s，attempt 与延迟一一对应", () => {
  const backoff = createPollErrorBackoff();
  const delays: number[] = [];
  const attempts: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    delays.push(backoff.nextDelayMs());
    attempts.push(backoff.attempt);
  }
  assert.deepEqual(
    delays,
    [5_000, 10_000, 20_000, 40_000, 60_000, 60_000],
    "退避序列必须是 5s→10s→20s→40s→60s（封顶）",
  );
  // warn 行按“attempt=次数 nextMs=下次等待”格式输出（如 attempt=3 nextMs=20000），
  // attempt 必须与延迟一一对应，rig T6 直接读日志验证节奏。
  assert.deepEqual(attempts, [1, 2, 3, 4, 5, 6], "封顶后延迟不再增长，但失败计数仍递增供观测");
});

test("场景10：recordSuccess ⇒ 下次失败回到 5s；多实例状态互不影响", () => {
  const backoff = createPollErrorBackoff();
  backoff.nextDelayMs();
  backoff.nextDelayMs();
  backoff.nextDelayMs();
  backoff.recordSuccess();
  assert.equal(backoff.nextDelayMs(), 5_000, "任一成功 poll 周期后必须复位到 5s");
  assert.equal(backoff.attempt, 1);

  const other = createPollErrorBackoff();
  assert.equal(other.nextDelayMs(), 5_000, "每个 runtime loop 独立实例，互不影响");
});

// ---- 接线级：telegram 轮询失败 warn 节奏（escalation + 成功复位） ----

interface CapturedFetchCall {
  url: string;
  init: RequestInit | undefined;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 捕获 console.warn（createServiceLogger("bots") 的缺省 sink），finally 恢复。 */
function captureConsoleWarn(): { warns: string[]; restore(): void } {
  const warns: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map((arg) => String(arg)).join(" "));
  };
  return {
    warns,
    restore: () => {
      console.warn = original;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return true;
    }
    await sleep(50);
  }
  return condition();
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

type ScriptOutcome = "http500" | "ok";

/**
 * 双 bot 并行轮询（不同 token ⇒ 不同 URL 与不同 polling lock）：
 * - escalation bot：500,500 → 两条 warn（attempt=1 nextMs=5000 → attempt=2 nextMs=10000）。
 * - reset bot：500,ok,500 → 复位后第三次失败仍是 attempt=1 nextMs=5000（未复位会是 attempt=2）。
 * ok 响应带 100ms 延迟模拟长轮询节奏，避免内层循环空转。
 */
test("场景10（接线级）：telegram 连续失败 poll 的 warn nextMs 递增，成功周期后复位到 5s", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "zcode-backoff-wiring-"));
  const workspace = await mkdtemp(join(tmpdir(), "zcode-backoff-wiring-ws-"));
  setDataBaseDir(dataRoot);
  const configDir = getAppConfigDir();
  await mkdir(configDir, { recursive: true });

  const escalationBotId = "bot-tg-backoff-esc";
  const resetBotId = "bot-tg-backoff-reset";
  const tokens: Record<string, string> = {
    [escalationBotId]: "tg-token-esc",
    [resetBotId]: "tg-token-reset",
  };
  const scripts: Record<string, ScriptOutcome[]> = {
    [escalationBotId]: ["http500", "http500"],
    [resetBotId]: ["http500", "ok", "http500"],
  };
  const getUpdatesCounts: Record<string, number> = {};

  const bot = (id: string): BotConfig => ({
    id,
    name: `Backoff Bot ${id}`,
    provider: "telegram",
    credentialRef: `telegram-ref-${id}`,
    providerUserId: "4242",
    enabled: true,
    allowedWorkspaces: ["*"],
    // 配置 schema 要求 allowedCommands 的布尔字段完整（缺省会整体校验失败、轮询不启动）。
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
  });
  await writeFile(
    join(configDir, BOTS_CONFIG_FILE),
    JSON.stringify({ version: 3, bots: [bot(escalationBotId), bot(resetBotId)] }),
  );
  await writeFile(
    join(configDir, BOTS_STATE_FILE),
    JSON.stringify({
      version: 3,
      bots: Object.fromEntries(
        [escalationBotId, resetBotId].map((botId) => [
          botId,
          { botId, workspacePath: workspace, mode: "draft", activeTaskId: null, updatedAt: 1 },
        ]),
      ),
    }),
  );

  const credentialValues: Record<string, string> = {
    [`telegram-ref-${escalationBotId}`]: tokens[escalationBotId],
    [`telegram-ref-${resetBotId}`]: tokens[resetBotId],
  };
  const credentialService = {
    load: async (key: string) => credentialValues[key] ?? null,
  } as unknown as ICredentialService;

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
  const fakeTaskService = {
    listDeletedTaskIds: async () => [] as string[],
    resumeTask: async () => undefined,
    createTask: async () => ({ taskId: "task-backoff" }),
    deleteTask: async () => undefined,
    stopGeneration: async () => undefined,
    respondPermission: async () => true,
    respondElicitation: async () => true,
    getTaskModelSelection: async () => modelSelection,
    getTaskConfigOptions: async () => [],
    listTasks: async () => [],
    getTaskSnapshot: async () => null,
    sendPrompt: async () => undefined,
    setMode: async () => undefined,
    onDynamicStreamEvent: () => (): { dispose(): void } => ({ dispose: () => undefined }),
  } as unknown as IZCodeTaskService;

  const router = async (call: CapturedFetchCall): Promise<Response> => {
    const url = call.url;
    if (!url.startsWith("https://api.telegram.org/bot")) {
      throw new Error(`unexpected bot egress url: ${url}`);
    }
    if (!url.endsWith("/getUpdates")) {
      return jsonResponse({ ok: true });
    }
    const botId =
      Object.entries(tokens).find(([, token]) => url.includes(`/bot${token}/`))?.[0] ?? "";
    const count = (getUpdatesCounts[botId] = (getUpdatesCounts[botId] ?? 0) + 1);
    const outcome = scripts[botId]?.[count - 1];
    if (outcome === "http500") {
      return jsonResponse({ ok: false, description: "Internal Server Error" }, 500);
    }
    if (outcome === "ok") {
      // 模拟长轮询节奏，避免瞬时空响应让内层循环空转。
      await sleep(100);
      return jsonResponse({ ok: true, result: [] });
    }
    return hangUntilAborted(call);
  };
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) =>
    router({ url: String(input), init })) as typeof globalThis.fetch;

  const service = createBotsService({
    credentialService,
    zcodeTaskService: fakeTaskService,
    modelSelectionService,
    runStartupBackgroundTasks: true,
    providerFetch: fetchStub,
  });

  const warnCapture = captureConsoleWarn();
  try {
    // escalation bot：第 1 次失败立即；第 2 次失败在 5s 退避等待之后。
    const escalated = await waitForCondition(
      () =>
        warnCapture.warns.some(
          (line) =>
            line.includes("poll error backoff") &&
            line.includes("attempt=2") &&
            line.includes("nextMs=10000") &&
            line.includes(`bot=${escalationBotId}`),
        ),
      15_000,
    );
    assert.ok(escalated, "连续第 2 次失败必须等待 10s（nextMs 递增），且恰好一行 warn");
    assert.ok(
      warnCapture.warns.some(
        (line) =>
          line.includes("poll error backoff") &&
          line.includes("attempt=1") &&
          line.includes("nextMs=5000") &&
          line.includes(`bot=${escalationBotId}`),
      ),
      "第 1 次失败必须等待 5s",
    );

    // reset bot：500 → ok（复位）→ 500，第三次失败仍回到 attempt=1 nextMs=5000。
    const reset = await waitForCondition(
      () =>
        warnCapture.warns.filter(
          (line) => line.includes("poll error backoff") && line.includes(`bot=${resetBotId}`),
        ).length >= 2,
      15_000,
    );
    assert.ok(reset, "reset bot 必须完成 500→ok→500 三轮");
    const resetBackoffLines = warnCapture.warns.filter(
      (line) => line.includes("poll error backoff") && line.includes(`bot=${resetBotId}`),
    );
    assert.equal(
      resetBackoffLines.filter((line) => line.includes("attempt=1 nextMs=5000")).length,
      2,
      "成功周期后失败必须复位到 attempt=1 nextMs=5000（未复位会出现 attempt=2 nextMs=10000）",
    );
    assert.equal(
      resetBackoffLines.some((line) => line.includes("attempt=2")),
      false,
      "reset bot 的失败被成功周期隔断，不得出现 attempt=2",
    );
  } finally {
    warnCapture.restore();
    await (service as IBotsService & { disposeAllAndWait(): Promise<void> })
      .disposeAllAndWait()
      .catch(() => undefined);
    setDataBaseDir(null);
    await rm(dataRoot, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});
