import assert from "node:assert/strict";
import test from "node:test";
import { resolveRpcLogLevel, parseRpcCallSummary } from "../src/host/rpcLogLevel.ts";
import { createRpcLivenessTracker } from "../src/host/rpcLiveness.ts";
import { startHostMemoryDiagnosticsLog } from "../src/host/hostMemoryDiagnosticsLog.ts";

// specs/log-diagnostics-hygiene.md D1（3.14.5-alpha.2）验收：
// 高频轮询 OK 降 debug、FAIL 保持 warn；15 分钟存活汇总（挂既有 60s tick，不新增
// timer）；onTick 钩子随每个采样周期触发。

test("D1 轮询方法 OK 降 debug，FAIL 保持 warn，其余方法不受影响", () => {
  assert.equal(resolveRpcLogLevel("[rpc:call] bots.getStatus OK (12ms)"), "debug");
  assert.equal(resolveRpcLogLevel("[rpc:call] bots.getConfig OK (3ms)"), "debug");
  assert.equal(resolveRpcLogLevel("[rpc:call] off-peak-task.list OK (5ms)"), "debug");
  assert.equal(resolveRpcLogLevel("[rpc:call] bots.createBindCode OK (5ms)"), "debug");
  assert.equal(resolveRpcLogLevel("[rpc:call] bots.getStatus FAIL (12ms)"), "warn");
  assert.equal(resolveRpcLogLevel("[rpc:call] bots.new OK (30ms)"), "info");
  assert.equal(
    resolveRpcLogLevel("[rpc:call] zcode-agent.backgroundBashOutputV4 OK (1ms)"),
    "debug",
  );
});

test("D1 parseRpcCallSummary 支持 OK/FAIL 与 → 形态", () => {
  assert.deepEqual(parseRpcCallSummary("[rpc:call] bots.getStatus OK (12ms)"), {
    method: "bots.getStatus",
    ok: true,
  });
  assert.deepEqual(parseRpcCallSummary("[rpc:call] bots.getStatus FAIL (12ms)"), {
    method: "bots.getStatus",
    ok: false,
  });
  assert.deepEqual(parseRpcCallSummary("[rpc:call] bots.getStatus → OK (12ms)"), {
    method: "bots.getStatus",
    ok: true,
  });
  assert.equal(parseRpcCallSummary("[rpc:call] not-a-summary"), null);
});

test("D1 liveness：15 分钟边界输出汇总并清零；零活动不输出", () => {
  let now = 1_000_000;
  const lines: string[] = [];
  const logger = { info: (...args: unknown[]) => lines.push(args.map(String).join(" ")) };
  const tracker = createRpcLivenessTracker({ now: () => now });

  tracker.record("bots.getStatus", true);
  tracker.record("bots.getStatus", true);
  tracker.record("bots.getStatus", false);
  tracker.record("bots.new", true); // 未跟踪方法：不计数。

  tracker.maybeEmit(logger); // 未到 15 分钟：不输出。
  assert.equal(lines.length, 0);

  now += 900_001;
  tracker.maybeEmit(logger);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /\[rpc-liveness\] bots\.getStatus ok=2 fail=1 lastOkAge=\d+s/u);
  assert.match(lines[0]!, /bots\.getConfig ok=0 fail=0 lastOkAge=none/u);
  assert.doesNotMatch(lines[0]!, /bots\.new/u);

  // 汇总后区间清零；无新活动的下一窗输出 ok=0（存活信号：轮询停摆可见）。
  now += 900_001;
  tracker.maybeEmit(logger);
  assert.equal(lines.length, 2);
  assert.match(lines[1]!, /bots\.getStatus ok=0 fail=0 lastOkAge=\d+s/u);
});

test("D1 liveness：完全无记录的进程不刷零值汇总", () => {
  let now = 1_000_000;
  const lines: string[] = [];
  const logger = { info: (...args: unknown[]) => lines.push(args.map(String).join(" ")) };
  const tracker = createRpcLivenessTracker({ now: () => now });
  now += 900_001;
  tracker.maybeEmit(logger);
  assert.equal(lines.length, 0);
});

test("D1 onTick：挂既有 60s 采样 tick，每个周期触发且异常不影响采样", () => {
  let ticks = 0;
  const lines: string[] = [];
  const handles: Array<{ callback: () => void; intervalMs: number }> = [];
  const logger = {
    info: (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    },
  };
  const diagnostics = startHostMemoryDiagnosticsLog({
    logger,
    collectCounters: () => ({}),
    onTick: () => {
      ticks += 1;
      if (ticks === 1) {
        throw new Error("hook failure must not break sampling");
      }
    },
    now: () => 1_000_000,
    timer: {
      setInterval: (callback) => {
        handles.push({ callback, intervalMs: 0 });
        return { unref: () => undefined };
      },
      clearInterval: () => undefined,
    },
  });
  try {
    assert.equal(handles.length, 1, "必须复用唯一的采样定时器");
    handles[0]!.callback(); // 首个 tick：onTick 抛错被吞，采样继续。
    handles[0]!.callback();
    assert.equal(ticks, 2);
    assert.equal(lines.length, 1, "两次采样各写一条 [memory]（first/changed 语义不变）");
    assert.match(lines[0]!, /\[memory\] role=utility_host/u);
  } finally {
    diagnostics.stop();
  }
});
