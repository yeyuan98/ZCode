import { RPC_POLL_OK_DEBUG_METHODS } from "./rpcLogLevel.js";

/**
 * D1 轮询存活汇总（specs/log-diagnostics-hygiene.md）。
 *
 * R1 复盘后日志治理的折中：单个 `rpc:call … OK` 行降为 debug（它们占 2026-10-02 全天
 * 日志的 63%），生产日志的存活信号改由本 tracker 每 15 分钟输出一条汇总——每个被跟踪
 * 方法给出区间 OK 数、FAIL 数与最近一次 OK 距今秒数。轮询停摆从"日志变安静"变成
 * "ok=0 / lastOkAge 增长"的显式事实。
 *
 * 边界规则：不新增 timer——调用方（hostMemoryDiagnosticsLog）在既有 60s 诊断 tick 上
 * 调 maybeEmit；15 分钟边界由时间戳比较判定。计数在 logRpc 侧 record（只加计数，
 * 不改控制流）；汇总不得流入内存计数器注册表（会触发 countersDiffer 提前写盘，
 * 架空 D2 心跳降频——见 specs/log-diagnostics-hygiene.md D1）。
 */
export interface RpcLivenessLogger {
  info(...args: unknown[]): void;
}

export interface RpcLivenessTracker {
  record(method: string, ok: boolean): void;
  /** 每个 60s tick 调一次；跨过 15 分钟边界时输出一条汇总并清零区间计数。 */
  maybeEmit(logger: RpcLivenessLogger): void;
}

export interface RpcLivenessTrackerOptions {
  /** 汇总间隔，默认 15 分钟。 */
  intervalMs?: number;
  now?: () => number;
  /** 被跟踪方法；默认 RPC_POLL_OK_DEBUG_METHODS（与 OK 降级方法一致）。 */
  methods?: readonly string[];
}

interface MethodStats {
  okCount: number;
  failCount: number;
  lastOkAt: number | null;
}

export const RPC_LIVENESS_INTERVAL_MS = 900_000;

export function createRpcLivenessTracker(
  options: RpcLivenessTrackerOptions = {},
): RpcLivenessTracker {
  const intervalMs = options.intervalMs ?? RPC_LIVENESS_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const methods = options.methods ?? RPC_POLL_OK_DEBUG_METHODS;
  const stats = new Map<string, MethodStats>(
    methods.map((method) => [method, { okCount: 0, failCount: 0, lastOkAt: null }]),
  );
  let lastEmitAt = now();
  let everRecorded = false;

  return {
    record(method, ok) {
      const entry = stats.get(method);
      if (!entry) {
        return;
      }
      everRecorded = true;
      if (ok) {
        entry.okCount += 1;
        entry.lastOkAt = now();
      } else {
        entry.failCount += 1;
      }
    },
    maybeEmit(logger) {
      const current = now();
      if (current - lastEmitAt < intervalMs) {
        return;
      }
      lastEmitAt = current;
      // 完全无 RPC 活动的进程（纯本地窗口）不必刷零值汇总。
      if (!everRecorded) {
        return;
      }
      const parts = [...stats.entries()].map(([method, entry]) => {
        const age =
          entry.lastOkAt === null ? "none" : `${Math.round((current - entry.lastOkAt) / 1000)}s`;
        return `${method} ok=${entry.okCount} fail=${entry.failCount} lastOkAge=${age}`;
      });
      logger.info(`[rpc-liveness] ${parts.join(" | ")}`);
      for (const entry of stats.values()) {
        entry.okCount = 0;
        entry.failCount = 0;
      }
    },
  };
}
