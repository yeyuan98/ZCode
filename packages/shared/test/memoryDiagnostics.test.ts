import assert from "node:assert/strict";
import test from "node:test";
import {
  MEMORY_SAMPLE_HEARTBEAT_MS,
  createMemoryDiagnosticsRegistry,
  createMemorySampleWriteGate,
  formatMemorySampleLine,
  isDiagnosticMemoryCounterKey,
} from "../src/memoryDiagnostics.ts";

/**
 * 契约（specs/log-diagnostics-hygiene.md，3.14.5-alpha.2）：
 *
 * R1 事故复盘证明同进程可存在多个同名 service 实例（window host + attached-remote
 * 各建一个 bots service），注册表"后者覆盖前者"导致心跳读到空闲实例、活动实例的
 * bots.* 计数器全部不可见。修复：同名注册全部保留，collect 求和。
 */
test("同名多次注册聚合计数（R1 bots.* 恒零根修）", () => {
  const registry = createMemoryDiagnosticsRegistry();
  const first = registry.register("bots", () => ({
    typingIntervals: 1,
    runningTasks: 2,
  }));
  registry.register("bots", () => ({ typingIntervals: 1, streamSubs: 3 }));
  assert.deepEqual(registry.collect(), {
    "bots.typingIntervals": 2,
    "bots.runningTasks": 2,
    "bots.streamSubs": 3,
  });
  first.dispose();
  assert.deepEqual(registry.collect(), {
    "bots.typingIntervals": 1,
    "bots.streamSubs": 3,
  });
});

test("单个 provider 抛错只跳过自己（聚合语义不变）", () => {
  const registry = createMemoryDiagnosticsRegistry();
  registry.register("broken", () => {
    throw new Error("boom");
  });
  registry.register("ok", () => ({ live: 1 }));
  assert.deepEqual(registry.collect(), { "ok.live": 1 });
});

test("心跳默认间隔为 15 分钟（D2）", () => {
  assert.equal(MEMORY_SAMPLE_HEARTBEAT_MS, 900_000);
});

test("非诊断计数器变化不触发提前写盘，诊断键变化触发（D2）", () => {
  const gate = createMemorySampleWriteGate();
  const base = { role: "utility_host" as const, rssKb: 100, heapUsedKb: 50, counters: {} };
  assert.equal(gate.evaluate(base, 0), "first");

  // 非诊断计数器变化：不写盘（旧行为：写 changed —— R1 前日志刷屏来源）。
  const noisy = { ...base, counters: { "taskQueryCache.queryKeys": 5 } };
  assert.equal(gate.evaluate(noisy, 60_000), null);

  // 诊断键变化（哪怕回到 0）：写 changed（pendingUserInputs=2→0 正是 R1 关键证据）。
  const diagnostic = {
    ...base,
    counters: { "taskQueryCache.queryKeys": 5, "agent.pendingUserInputs": 2 },
  };
  assert.equal(gate.evaluate(diagnostic, 120_000), "changed");
  const recovered = {
    ...base,
    counters: { "taskQueryCache.queryKeys": 5, "agent.pendingUserInputs": 0 },
  };
  assert.equal(gate.evaluate(recovered, 180_000), "changed");

  // 无诊断变化：到 15 分钟才 heartbeat。
  assert.equal(gate.evaluate(recovered, 180_000 + 60_000), null);
  assert.equal(gate.evaluate(recovered, 180_000 + 900_000), "heartbeat");
});

test("格式化跳过恒零计数器，诊断键即使为 0 也输出（D3 行格式）", () => {
  const line = formatMemorySampleLine(
    {
      role: "renderer",
      rssKb: 1,
      counters: {
        "projection.rows": 0,
        "shiki.highlighters": 0,
        "agent.pendingUserInputs": 0,
        "taskQueryCache.queryKeys": 3,
      },
    },
    "heartbeat",
  );
  assert.match(line, /agent\.pendingUserInputs=0/);
  assert.match(line, /taskQueryCache\.queryKeys=3/);
  assert.doesNotMatch(line, /projection\.rows/);
  assert.doesNotMatch(line, /shiki\.highlighters/);
});

test("诊断键集合覆盖四类进程的关键计数", () => {
  for (const key of [
    "agent.pendingUserInputs",
    "agent.pendingPermissions",
    "agent.sessionEmitters",
    "agent.seqStates",
    "bots.typingIntervals",
    "bots.runningTasks",
    "bots.streamSubs",
    "bots.liveStatusProgress",
  ]) {
    assert.equal(isDiagnosticMemoryCounterKey(key), true, key);
  }
  assert.equal(isDiagnosticMemoryCounterKey("taskQueryCache.queryKeys"), false);
  assert.equal(isDiagnosticMemoryCounterKey("projection.rows"), false);
});
