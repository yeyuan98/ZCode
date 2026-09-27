import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AutomationRepo, OffPeakTaskRepo } from "@zcode/services/node";
import { createSchedulerRuntime } from "../src/scheduler/schedulerRuntime.js";
import type {
  MainToSchedulerMessage,
  SchedulerToMainMessage,
} from "../src/scheduler/schedulerProtocol.js";

// P3 本地准入：node:test 端口 shim 直接驱动真实 scheduler runtime（Electron-free）。
// main 侧行为（settings 属主 + withinWindow 求值 + Run-now 转发）由 fake admission
// responder 模拟；scheduler↔repo↔消息协议全部走真实代码路径。

interface PortShim {
  port: SchedulerPortShimApi;
  incoming: (message: MainToSchedulerMessage) => void;
  outgoing: SchedulerToMainMessage[];
}

interface SchedulerPortShimApi {
  postMessage(message: SchedulerToMainMessage): void;
  onMessage(listener: (message: MainToSchedulerMessage) => void): void;
}

function createPortShim(admissionAllowed: () => boolean): PortShim {
  const outgoing: SchedulerToMainMessage[] = [];
  const listeners: ((message: MainToSchedulerMessage) => void)[] = [];
  return {
    outgoing,
    incoming: (message) => {
      for (const listener of listeners) listener(message);
    },
    port: {
      postMessage: (message) => {
        outgoing.push(message);
        // fake main：correlated 准入询问按当前设置求值后异步回包（模拟跨进程时序）。
        if (message.type === "offpeak-admission-request") {
          const { requestId } = message;
          queueMicrotask(() => {
            for (const listener of listeners) {
              listener({
                type: "offpeak-admission-response",
                requestId,
                allowed: admissionAllowed(),
              });
            }
          });
        }
      },
      onMessage: (listener) => {
        listeners.push(listener);
      },
    },
  };
}

function dispatchRequests(shim: PortShim): SchedulerToMainMessage[] {
  return shim.outgoing.filter((message) => message.type === "offpeak-dispatch-request");
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("scheduler harness wait timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const MODEL_SELECTION = {
  providerId: "provider-a",
  modelId: "model-x",
  options: { reasoningLevel: "high" },
};

async function seedQueuedTask(repo: OffPeakTaskRepo, id: string): Promise<void> {
  await repo.create(
    {
      title: `task-${id}`,
      prompt: `instructions-${id}`,
      permissionMode: "build",
      modelSelection: MODEL_SELECTION,
      workspacePath: "/workspace/scheduler-harness",
      workspaceIdentity: undefined,
    },
    { offPeakTaskId: `offpeak-${id}` },
  );
}

interface Harness {
  shim: PortShim;
  runtime: ReturnType<typeof createSchedulerRuntime>;
  offPeakRepo: OffPeakTaskRepo;
  automationRepo: AutomationRepo;
  dispose: () => Promise<void>;
}

async function startHarness(admissionAllowed: () => boolean): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "zcode-scheduler-harness-"));
  const dbPath = join(dir, "tasks-index.sqlite");
  const automationRepo = new AutomationRepo(dbPath);
  const offPeakRepo = new OffPeakTaskRepo(dbPath);
  const shim = createPortShim(admissionAllowed);
  const runtime = createSchedulerRuntime({
    port: shim.port,
    automationRepo,
    offPeakRepo,
    // 不启用周期轮询：测试显式 requestTick；不退出进程。
    pollIntervalMs: 2_147_483_000,
    exitOnDispose: false,
  });
  await waitFor(() =>
    shim.outgoing.some(
      (message) =>
        message.type === "scheduler-log" && message.message.includes("cron scheduler started"),
    ),
  );
  return {
    shim,
    runtime,
    offPeakRepo,
    automationRepo,
    dispose: async () => {
      await runtime.dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("准入拒绝 → 本轮不派发；放行 → 认领派发 → 成功回报 markRunning 结算", async () => {
  let allowed = false;
  const harness = await startHarness(() => allowed);
  try {
    await seedQueuedTask(harness.offPeakRepo, "admit");
    harness.runtime.requestTick();
    // 首轮 tick：窗口关（admission 拒绝）→ 已发出询问但零派发。
    await waitFor(() => harness.shim.outgoing.some((m) => m.type === "offpeak-admission-request"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(dispatchRequests(harness.shim).length, 0, "窗口关闭时不得派发");
    assert.equal((await harness.offPeakRepo.get("offpeak-admit"))?.status, "queued");

    // 放行后重跑 tick：认领并发送派发请求（带任务持久化的模型选择）。
    allowed = true;
    harness.runtime.requestTick();
    await waitFor(() => dispatchRequests(harness.shim).length === 1);
    const request = dispatchRequests(harness.shim)[0]!;
    assert.equal(request.type, "offpeak-dispatch-request");
    assert.equal(request.offPeakTaskId, "offpeak-admit");
    assert.deepEqual(request.modelSelection, MODEL_SELECTION);
    assert.equal(request.permissionMode, "build");

    // main → scheduler：派发成功回报 → markRunning 结算（session/conversation 回填）。
    harness.shim.incoming({
      type: "offpeak-dispatch-result",
      offPeakTaskId: "offpeak-admit",
      ok: true,
      conversationId: "conv-admit",
      sessionId: "conv-admit",
    });
    await waitFor(
      async () => (await harness.offPeakRepo.get("offpeak-admit"))?.status === "running",
    );
    const running = await harness.offPeakRepo.get("offpeak-admit");
    assert.equal(running?.conversationId, "conv-admit");
    assert.equal(running?.sessionId, "conv-admit");

    // run-to-completion：窗口随后关闭不产生任何回收/重排——终态只能由 loop 结果写入。
    allowed = false;
    harness.runtime.requestTick();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(
      (await harness.offPeakRepo.get("offpeak-admit"))?.status,
      "running",
      "窗口关闭不得中断在跑任务",
    );
    assert.equal(dispatchRequests(harness.shim).length, 1, "无新派发");
  } finally {
    await harness.dispose();
  }
});

test("Run-now：绕过窗口强制派发；claim_running=1 时幂等 no-op；释放后可再次认领", async () => {
  const harness = await startHarness(() => false);
  try {
    await seedQueuedTask(harness.offPeakRepo, "runnow");
    harness.runtime.requestTick();
    // 等 tick 走完（结束时会上报 active-count），避免把在途 tick 的准入询问误记到 run-now。
    await waitFor(() => harness.shim.outgoing.some((m) => m.type === "offpeak-admission-request"));
    await waitFor(() => harness.shim.outgoing.some((m) => m.type === "offpeak-active-count"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(dispatchRequests(harness.shim).length, 0, "窗口关：正常路径零派发");

    // main → scheduler：Run-now 强制派发（不产生新的准入询问）。
    const admissionRequestsBefore = harness.shim.outgoing.filter(
      (m) => m.type === "offpeak-admission-request",
    ).length;
    harness.shim.incoming({ type: "offpeak-run-now", offPeakTaskId: "offpeak-runnow" });
    await waitFor(() => dispatchRequests(harness.shim).length === 1);
    assert.equal(dispatchRequests(harness.shim)[0]!.offPeakTaskId, "offpeak-runnow");
    assert.equal(
      harness.shim.outgoing.filter((m) => m.type === "offpeak-admission-request").length,
      admissionRequestsBefore,
      "run-now 不应触发新的准入询问",
    );

    // 竞态：任务已在派发在途（claim_running=1），再次 Run-now 是 no-op。
    harness.shim.incoming({ type: "offpeak-run-now", offPeakTaskId: "offpeak-runnow" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(dispatchRequests(harness.shim).length, 1, "不得产生第二次派发请求");

    // 释放认领（模拟 transient 派发失败）后 Run-now 可再次认领。
    await harness.offPeakRepo.releaseClaim("offpeak-runnow", { error: "transient" });
    harness.shim.incoming({ type: "offpeak-run-now", offPeakTaskId: "offpeak-runnow" });
    await waitFor(() => dispatchRequests(harness.shim).length === 2);
  } finally {
    await harness.dispose();
  }
});

test("permanent 派发失败 → 任务转 failed（确定性错误不再无限退避）", async () => {
  const harness = await startHarness(() => true);
  try {
    await seedQueuedTask(harness.offPeakRepo, "permanent");
    harness.runtime.requestTick();
    await waitFor(() => dispatchRequests(harness.shim).length === 1);
    harness.shim.incoming({
      type: "offpeak-dispatch-result",
      offPeakTaskId: "offpeak-permanent",
      ok: false,
      failureKind: "permanent",
      error: "model selection unresolvable",
    });
    await waitFor(
      async () => (await harness.offPeakRepo.get("offpeak-permanent"))?.status === "failed",
    );
    const failed = await harness.offPeakRepo.get("offpeak-permanent");
    assert.equal(failed?.failureReason, "model selection unresolvable");
  } finally {
    await harness.dispose();
  }
});

test("启动恢复：running 残留任务被置回 queued（restart-recovery 语义保留）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-scheduler-recovery-"));
  const dbPath = join(dir, "tasks-index.sqlite");
  {
    const repo = new OffPeakTaskRepo(dbPath);
    await repo.ensureReady();
    await repo.create(
      {
        title: "interrupted",
        prompt: "half-done work",
        permissionMode: "build",
        modelSelection: MODEL_SELECTION,
        workspacePath: "/workspace/scheduler-harness",
        workspaceIdentity: undefined,
      },
      { offPeakTaskId: "offpeak-interrupted" },
    );
    await repo.claimDue(1_000);
    await repo.markRunning("offpeak-interrupted", {
      startedAt: 1_000,
      conversationId: "conv-old",
      sessionId: "conv-old",
    });
    repo.close();
  }
  const automationRepo = new AutomationRepo(dbPath);
  const offPeakRepo = new OffPeakTaskRepo(dbPath);
  const shim = createPortShim(() => true);
  const runtime = createSchedulerRuntime({
    port: shim.port,
    automationRepo,
    offPeakRepo,
    pollIntervalMs: 2_147_483_000,
    exitOnDispose: false,
  });
  try {
    await waitFor(async () => (await offPeakRepo.get("offpeak-interrupted"))?.status === "queued");
    const recovered = await offPeakRepo.get("offpeak-interrupted");
    assert.equal(recovered?.sessionId, "conv-old", "session 保留供 resume 续跑");
  } finally {
    await runtime.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
