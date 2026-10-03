/**
 * 进程内存本地诊断日志的共用纯逻辑。
 *
 * main / renderer / host / agent CLI 四类进程各自采样，但写盘门控、行格式和计数器注册表
 * 只有这一份实现，避免四处各写一套阈值。本文件不依赖 Node / DOM API。
 */

export type MemorySampleRole = "main" | "renderer" | "utility_host" | "agent_node";

export type MemorySampleWriteReason = "first" | "changed" | "heartbeat";

export interface MemorySampleFields {
  rssKb?: number;
  heapUsedKb?: number;
  heapTotalKb?: number;
  externalKb?: number;
  arrayBuffersKb?: number;
}

export interface MemorySample extends MemorySampleFields {
  role: MemorySampleRole;
  /** `<provider>.<key>` → 数值；只允许纯读取得到的计数。 */
  counters: Record<string, number>;
}

export interface MemorySampleWriteGateOptions {
  /** heapUsedKb 相对上一次写盘值的变化比例阈值，默认 5%。 */
  heapDeltaRatio?: number;
  /**
   * rssKb / externalKb 相对上一次写盘值的变化比例阈值，默认 10%。
   * 真机上 host 进程 RSS 从 240MB 冲到 1.5GB、externalKb 冲到 1.3GB，而 heapUsed 几乎不动，
   * 只看 heap 的门控把这一分钟判成 heartbeat 静默丢掉；native / external 内存必须单独参与判定。
   */
  nativeDeltaRatio?: number;
  /** 无变化时的心跳间隔，默认 15 分钟。 */
  heartbeatMs?: number;
  /**
   * 哪些计数器键的变化允许触发提前写盘（reason=changed）；默认只认诊断相关键
   * （isDiagnosticMemoryCounterKey）。R1 前“任意计数器变化都写盘”让活动任务的
   * 高频计数器把心跳行刷成每分钟一条。
   */
  counterChangeKeys?: (key: string) => boolean;
}

export interface MemorySampleWriteGate {
  /**
   * 判定本次样本是否写盘。返回非 null 时表示应写盘，并把该样本记为“上一次写盘值”。
   */
  evaluate(sample: MemorySample, nowMs: number): MemorySampleWriteReason | null;
}

export const MEMORY_SAMPLE_INTERVAL_MS = 60_000;
export const MEMORY_SAMPLE_HEAP_DELTA_RATIO = 0.05;
export const MEMORY_SAMPLE_NATIVE_DELTA_RATIO = 0.1;
// D2（specs/log-diagnostics-hygiene.md）：无变化心跳间隔 5 分钟 → 15 分钟。
// 内存比例阈值不动——真机 RSS/external 突增检测（见上方注释）仍按分钟级生效。
export const MEMORY_SAMPLE_HEARTBEAT_MS = 900_000;

/**
 * D2：触发提前写盘（reason=changed）的“诊断相关”计数器键集合（按最后一段匹配，
 * 覆盖 agent.* 与 bots.* 两族）。其余计数器变化不触发写盘，随心跳/其他原因落盘；
 * 行格式中恒零的非诊断计数器也会被跳过（回到 0 的诊断键仍然输出——R1 中
 * `agent.pendingUserInputs=2 → 0` 正是关键恢复证据）。
 */
const MEMORY_DIAGNOSTIC_COUNTER_KEY_SUFFIXES: readonly string[] = [
  "pendingUserInputs",
  "pendingPermissions",
  "sessionEmitters",
  "seqStates",
  "typingIntervals",
  "runningTasks",
  "streamSubs",
  "liveStatusProgress",
];

export function isDiagnosticMemoryCounterKey(key: string): boolean {
  const suffix = key.slice(key.lastIndexOf(".") + 1);
  return MEMORY_DIAGNOSTIC_COUNTER_KEY_SUFFIXES.includes(suffix);
}

const MEMORY_FIELD_ORDER: readonly (keyof MemorySampleFields)[] = [
  "rssKb",
  "heapUsedKb",
  "heapTotalKb",
  "externalKb",
  "arrayBuffersKb",
];

function countersDiffer(
  a: Record<string, number>,
  b: Record<string, number>,
  keyMatters: (key: string) => boolean,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (keyMatters(key) && a[key] !== b[key]) {
      return true;
    }
  }
  return false;
}

function exceedsRatio(
  current: number | undefined,
  previous: number | undefined,
  ratio: number,
): boolean {
  return (
    current !== undefined &&
    previous !== undefined &&
    Math.abs(current - previous) > Math.max(previous, 1) * ratio
  );
}

export function createMemorySampleWriteGate(
  options: MemorySampleWriteGateOptions = {},
): MemorySampleWriteGate {
  const heapDeltaRatio = options.heapDeltaRatio ?? MEMORY_SAMPLE_HEAP_DELTA_RATIO;
  const nativeDeltaRatio = options.nativeDeltaRatio ?? MEMORY_SAMPLE_NATIVE_DELTA_RATIO;
  const heartbeatMs = options.heartbeatMs ?? MEMORY_SAMPLE_HEARTBEAT_MS;
  const counterChangeKeys = options.counterChangeKeys ?? isDiagnosticMemoryCounterKey;
  let lastWritten: MemorySample | undefined;
  let lastWrittenAt = 0;

  return {
    evaluate(sample, nowMs) {
      let reason: MemorySampleWriteReason | null = null;
      if (!lastWritten) {
        reason = "first";
      } else if (
        exceedsRatio(sample.heapUsedKb, lastWritten.heapUsedKb, heapDeltaRatio) ||
        exceedsRatio(sample.rssKb, lastWritten.rssKb, nativeDeltaRatio) ||
        exceedsRatio(sample.externalKb, lastWritten.externalKb, nativeDeltaRatio)
      ) {
        reason = "changed";
      } else if (countersDiffer(sample.counters, lastWritten.counters, counterChangeKeys)) {
        reason = "changed";
      } else if (nowMs - lastWrittenAt >= heartbeatMs) {
        reason = "heartbeat";
      }
      if (reason) {
        lastWritten = { ...sample, counters: { ...sample.counters } };
        lastWrittenAt = nowMs;
      }
      return reason;
    },
  };
}

export function bytesToKb(bytes: number): number {
  return Math.round(bytes / 1024);
}

/** 把 Node `process.memoryUsage()` 的结果换算成 KB 字段；字段缺失时省略。 */
export function memoryUsageToSampleFields(usage: {
  rss?: number;
  heapUsed?: number;
  heapTotal?: number;
  external?: number;
  arrayBuffers?: number;
}): MemorySampleFields {
  const fields: MemorySampleFields = {};
  if (typeof usage.rss === "number") fields.rssKb = bytesToKb(usage.rss);
  if (typeof usage.heapUsed === "number") fields.heapUsedKb = bytesToKb(usage.heapUsed);
  if (typeof usage.heapTotal === "number") fields.heapTotalKb = bytesToKb(usage.heapTotal);
  if (typeof usage.external === "number") fields.externalKb = bytesToKb(usage.external);
  if (typeof usage.arrayBuffers === "number") {
    fields.arrayBuffersKb = bytesToKb(usage.arrayBuffers);
  }
  return fields;
}

/**
 * 单行 `key=value` 格式：固定内存字段在前，计数器按字典序在后，全部取整。
 * 例：`[memory] role=main reason=first rssKb=1 heapUsedKb=2 app.windows=1`
 */
export function formatMemorySampleLine(
  sample: MemorySample,
  reason: MemorySampleWriteReason,
): string {
  const parts = [`[memory]`, `role=${sample.role}`, `reason=${reason}`];
  for (const field of MEMORY_FIELD_ORDER) {
    const value = sample[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      parts.push(`${field}=${Math.round(value)}`);
    }
  }
  for (const key of Object.keys(sample.counters).sort()) {
    const value = sample.counters[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      // D3：恒零的非诊断计数器跳过；诊断键即使为 0 也输出（恢复信号）。
      if (value === 0 && !isDiagnosticMemoryCounterKey(key)) {
        continue;
      }
      parts.push(`${key}=${Math.round(value)}`);
    }
  }
  return parts.join(" ");
}

export type MemoryDiagnosticsProvider = () => Record<string, number>;

export interface MemoryDiagnosticsRegistry {
  /**
   * 同名允许多次注册（R1 根修：同进程多实例同名覆盖导致 bots.* 恒零）；
   * collect 时同名键求和。dispose 按 provider 身份移除，不影响其他注册。
   */
  register(name: string, provider: MemoryDiagnosticsProvider): { dispose(): void };
  /** 逐个调用 provider，键以 `<name>.` 为前缀、同名键跨实例求和；单个 provider 抛错只跳过它自己。 */
  collect(): Record<string, number>;
}

export function createMemoryDiagnosticsRegistry(): MemoryDiagnosticsRegistry {
  const providers = new Map<string, MemoryDiagnosticsProvider[]>();
  return {
    register(name, provider) {
      const existing = providers.get(name);
      if (existing) {
        existing.push(provider);
      } else {
        providers.set(name, [provider]);
      }
      return {
        dispose() {
          const list = providers.get(name);
          if (!list) {
            return;
          }
          const next = list.filter((item) => item !== provider);
          if (next.length > 0) {
            providers.set(name, next);
          } else {
            providers.delete(name);
          }
        },
      };
    },
    collect() {
      const result: Record<string, number> = {};
      for (const [name, list] of providers) {
        for (const provider of list) {
          try {
            for (const [key, value] of Object.entries(provider())) {
              if (typeof value === "number" && Number.isFinite(value)) {
                const prefixed = `${name}.${key}`;
                result[prefixed] = (result[prefixed] ?? 0) + value;
              }
            }
          } catch {
            // 诊断 provider 只做纯读取；任一 provider 异常不能影响其他计数器或业务。
          }
        }
      }
      return result;
    },
  };
}
