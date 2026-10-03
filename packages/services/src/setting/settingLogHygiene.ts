import type { AppSettings } from "@zcode/shared";
import { formatLogPrefix } from "@zcode/shared";

/**
 * D4 设置日志（specs/log-diagnostics-hygiene.md，3.14.5-alpha.2）：
 *
 * 每个本地自然日一条脱敏全量快照 + 同日只记变更键；单日日志自包含（快照不依赖
 * 前一天）。跨日补发挂 desktop host 既有 60s 诊断 tick（maybeLogSettingsDailyBaseline
 * 只读内存缓存，无 IO）。模块级状态每进程一份；多 host 进程各出一条基线，
 * 行内 pid 前缀可区分。lastKnownSettings 只作日志对照，不参与任何业务判定。
 */

const SETTINGS_DELTA_MAX_ENTRIES = 30;

const SETTINGS_REDACTED_PATTERN =
  /token|secret|password|passwd|credential|key|proxy|authorization/i;
const SETTINGS_REDACTED = "<redacted>";

let lastKnownSettings: AppSettings | undefined;
let lastSettingsSnapshotDay = "";

const log = (...args: unknown[]) =>
  console.log(formatLogPrefix("settingService", process.pid), ...args);

function localDayString(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function isSensitiveSettingsPath(path: string): boolean {
  return path.split(".").some((segment) => SETTINGS_REDACTED_PATTERN.test(segment));
}

/** 深拷贝并按路径段名脱敏（httpProxy URL 可内嵌凭据——评审修复项）。 */
function redactSettingsValue(value: unknown, path = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSettingsValue(item, path));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redactSettingsValue(inner, path ? `${path}.${key}` : key);
    }
    return result;
  }
  return isSensitiveSettingsPath(path) ? SETTINGS_REDACTED : value;
}

function formatSettingsValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 80 ? `"${value.slice(0, 77)}…"` : `"${value}"`;
  }
  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).length} keys}`;
  }
  return String(value);
}

interface SettingsDeltaResult {
  entries: string[];
  capped: boolean;
}

/** 生成 `path: old -> new` 增量项；数组以长度对比，避免刷屏。 */
function diffSettingsEntries(
  previous: unknown,
  next: unknown,
  path: string,
  result: SettingsDeltaResult,
): void {
  const { entries } = result;
  if (entries.length >= SETTINGS_DELTA_MAX_ENTRIES) {
    result.capped = true;
    return;
  }
  const prevObj = previous && typeof previous === "object" && !Array.isArray(previous);
  const nextObj = next && typeof next === "object" && !Array.isArray(next);
  if (prevObj && nextObj) {
    const keys = new Set([
      ...Object.keys(previous as Record<string, unknown>),
      ...Object.keys(next as Record<string, unknown>),
    ]);
    for (const key of keys) {
      const prevValue = (previous as Record<string, unknown>)[key];
      const nextValue = (next as Record<string, unknown>)[key];
      if (prevValue === undefined || nextValue === undefined) {
        entries.push(
          `${path ? `${path}.${key}` : key}: ${formatSettingsValue(prevValue ?? nextValue)} ${nextValue === undefined ? "removed" : "added"}`,
        );
      } else {
        diffSettingsEntries(prevValue, nextValue, path ? `${path}.${key}` : key, result);
      }
    }
    return;
  }
  if (JSON.stringify(previous) !== JSON.stringify(next)) {
    entries.push(`${path}: ${formatSettingsValue(previous)} -> ${formatSettingsValue(next)}`);
  }
}

function redactSettingsEntry(entry: string): string {
  const colonAt = entry.indexOf(":");
  if (colonAt > 0 && isSensitiveSettingsPath(entry.slice(0, colonAt))) {
    return `${entry.slice(0, colonAt)}: ${SETTINGS_REDACTED}`;
  }
  return entry;
}

function logSettingsSnapshot(settings: AppSettings, settingsFile: string): void {
  lastSettingsSnapshotDay = localDayString();
  log(
    "settings daily snapshot:",
    `file=${settingsFile}`,
    JSON.stringify(redactSettingsValue(settings)),
  );
}

/** 写盘日志入口：当日首条（或进程内首条）输出快照，同日后续输出增量行。 */
export function logSettingsWrite(settings: AppSettings, settingsFile: string): void {
  const day = localDayString();
  if (day !== lastSettingsSnapshotDay) {
    logSettingsSnapshot(settings, settingsFile);
    return;
  }
  if (!lastKnownSettings) {
    return;
  }
  const result: SettingsDeltaResult = { entries: [], capped: false };
  diffSettingsEntries(lastKnownSettings, settings, "", result);
  if (result.entries.length === 0) {
    return;
  }
  const suffix = result.capped ? ` …(+more, capped ${SETTINGS_DELTA_MAX_ENTRIES})` : "";
  log(
    "settings changed:",
    `file=${settingsFile}`,
    result.entries.map(redactSettingsEntry).join("; ") + suffix,
  );
}

/** 成功读到真实落盘配置后刷新日志对照缓存（只作日志用途）。 */
export function noteSettingsLoaded(settings: AppSettings): void {
  lastKnownSettings = settings;
}

/** 写盘成功后推进对照缓存（增量 diff 的旧值来源）。 */
export function noteSettingsPersisted(settings: AppSettings): void {
  lastKnownSettings = settings;
}

/**
 * 跨日补发（desktop host 在既有 60s 诊断 tick 上调用）。只读内存缓存，无 IO；
 * 进程尚不知道任何设置时不输出（当天首次读/写会触发快照）。
 */
export function maybeLogSettingsDailyBaseline(settingsFile: string): void {
  if (!lastKnownSettings) {
    return;
  }
  const day = localDayString();
  if (day !== lastSettingsSnapshotDay) {
    logSettingsSnapshot(lastKnownSettings, settingsFile);
  }
}
