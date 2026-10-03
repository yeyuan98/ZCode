import { access, readFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AppSettings } from "@zcode/shared";
import {
  appSettingsPatchSchema,
  appSettingsSchema,
  formatLogPrefix,
  formatZodError,
} from "@zcode/shared";
import type { ISettingService } from "./setting.js";
import { normalizeSettingsPatch } from "#src/setting/normalizeSettingsPatch.js";
import { copyDataDirectory, getDataBaseDir, validateDataBaseDirTarget } from "../paths.js";
import { isEffectiveDevelopmentNodeEnv } from "../runtime-tools/nodeEnv.js";
import { maybeThrowInjectedFsFault } from "../fs/fsFaultInjection.js";
import { atomicWriteText } from "../fs/atomicFileUtils.js";
import { withSettingsWriteQueueTimeout } from "./settingsWriteQueue.js";
const MAX_RECENT_PROJECTS = 10;
const DEFAULT_PROJECT_NAME = "ZCodeProject";
const SETTINGS_PARSE_RETRY_DELAY_MS = 300;
const SETTINGS_PARSE_RETRY_COUNT = 3;
/** D4（specs/log-diagnostics-hygiene.md）：单条增量行最多列出的变更键数。 */
const SETTINGS_DELTA_MAX_ENTRIES = 30;

// D4 状态（模块级、每进程一份；多 host 进程各出一条基线，行内 pid 前缀可区分）：
// lastKnownSettings 只作日志对照（读取/写盘成功后更新），不参与任何业务判定。
let lastKnownSettings: AppSettings | undefined;
let lastSettingsSnapshotDay = "";

const SETTINGS_REDACTED_PATTERN =
  /token|secret|password|passwd|credential|key|proxy|authorization/i;
const SETTINGS_REDACTED = "<redacted>";

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

/** 生成 `path: old -> new` 增量项；数组以长度对比，避免刷屏。 */
function diffSettingsEntries(
  previous: unknown,
  next: unknown,
  path: string,
  entries: string[],
): void {
  if (entries.length >= SETTINGS_DELTA_MAX_ENTRIES) {
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
        diffSettingsEntries(prevValue, nextValue, path ? `${path}.${key}` : key, entries);
      }
    }
    return;
  }
  if (JSON.stringify(previous) !== JSON.stringify(next)) {
    entries.push(`${path}: ${formatSettingsValue(previous)} -> ${formatSettingsValue(next)}`);
  }
}

function redactSettingsEntry(entry: string): string {
  // `path: old -> new` 形态：敏感路径的值在生成侧已经由 redactSettingsValue 处理；
  // 这里兜底替换敏感路径行的值（双保险，代价极低）。
  const colonAt = entry.indexOf(":");
  if (colonAt > 0 && isSensitiveSettingsPath(entry.slice(0, colonAt))) {
    return `${entry.slice(0, colonAt)}: ${SETTINGS_REDACTED}`;
  }
  return entry;
}

/**
 * D4：设置写盘日志。每个本地自然日第一条（或进程内第一条）输出全量快照（脱敏），
 * 同日后续写盘只输出变更键；跨日由 maybeLogSettingsDailyBaseline 在 60s 诊断 tick
 * 上补发基线，保证“只导出某一天的日志也自包含”。
 */
function logSettingsWrite(settings: AppSettings): void {
  const day = localDayString();
  if (day !== lastSettingsSnapshotDay) {
    lastSettingsSnapshotDay = day;
    log("settings daily snapshot:", JSON.stringify(redactSettingsValue(settings)));
    return;
  }
  if (!lastKnownSettings) {
    return;
  }
  const entries: string[] = [];
  diffSettingsEntries(lastKnownSettings, settings, "", entries);
  if (entries.length === 0) {
    return;
  }
  const suffix =
    entries.length >= SETTINGS_DELTA_MAX_ENTRIES
      ? ` …(+more, capped ${SETTINGS_DELTA_MAX_ENTRIES})`
      : "";
  log("settings changed:", entries.map(redactSettingsEntry).join("; ") + suffix);
}

/**
 * D4 跨日补发（desktop host 在既有 60s 诊断 tick 上调用；见
 * packages/desktop/src/host/hostMemoryDiagnosticsLog.ts onTick）。只读内存缓存，
 * 无 IO；进程尚不知道任何设置时不输出（当天首次读/写会触发快照）。
 */
export function maybeLogSettingsDailyBaseline(): void {
  if (!lastKnownSettings) {
    return;
  }
  const day = localDayString();
  if (day !== lastSettingsSnapshotDay) {
    lastSettingsSnapshotDay = day;
    log("settings daily snapshot:", JSON.stringify(redactSettingsValue(lastKnownSettings)));
  }
}

const log = (...args: unknown[]) =>
  console.log(formatLogPrefix("settingService", process.pid), ...args);
const debugLog = (...args: unknown[]) => {
  // NODE_ENV 来自用户 shell 时会误导服务层 debug 开关；统一使用 ZCODE_RUNTIME_ENV。
  if (!isEffectiveDevelopmentNodeEnv()) {
    return;
  }
  console.debug(formatLogPrefix("settingService", process.pid), ...args);
};

function resolveUserHomeDir() {
  // 独立桌面 Dev 实例已设置自己的 home，设置服务却仍写真实 HOME，
  // 导致启动迁移和外观操作污染其他实例。与 Electron 的显式 home 覆盖保持一致。
  const envHome =
    process.env.ZCODE_DESKTOP_HOME_DIR?.trim() ||
    process.env.HOME?.trim() ||
    process.env.USERPROFILE?.trim();
  return envHome && envHome.length > 0 ? envHome : homedir();
}

function getSettingsDir() {
  return join(resolveUserHomeDir(), ".zcode", "v2");
}

function getSettingsFile() {
  return join(getSettingsDir(), "setting.json");
}

function defaultSettings(): AppSettings {
  return appSettingsSchema.parse({});
}

function buildCorruptSettingsBackupPath(settingsFile: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${settingsFile}.corrupt-${timestamp}`;
}

async function quarantineCorruptSettingsFile(settingsFile: string, error: unknown): Promise<void> {
  const backupPath = buildCorruptSettingsBackupPath(settingsFile);
  try {
    // 用户手动编辑或远端磁盘异常可能把 setting.json 写成非 JSON（例如 ":wq"）。
    // 如果只返回默认值不隔离坏文件，每次启动都会重复解析失败；这里保留备份后让后续 update 重建合法配置。
    maybeThrowInjectedFsFault({ operation: "rename", path: settingsFile });
    await rename(settingsFile, backupPath);
    log("invalid settings json backed up:", backupPath, "error:", error);
  } catch (renameError) {
    if (
      renameError &&
      typeof renameError === "object" &&
      "code" in renameError &&
      (renameError as { code?: string }).code === "ENOENT"
    ) {
      // 启动时多个服务可能同时读取同一个坏 setting.json。
      // 第一个读取已经完成隔离后，后续读取再 rename 会遇到 ENOENT；这是并发下的预期结果，不应当按备份失败刷错误日志。
      log("invalid settings json already quarantined by another reader, returning defaults");
      return;
    }
    log("invalid settings json backup failed, returning defaults. error:", renameError);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldPersistSettingsMigrations(rawValue: unknown): boolean {
  // P1：旧账号连接导入（legacyAccountConnectionSettings）已随 providerFamilyConnectionSelections 字段删除。
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return false;
  const raw = rawValue as Record<string, unknown>;
  return (
    raw.closeToTrayOnWindowsMigrationInitialized !== true ||
    raw.messageStreamShowReasoningMigrationInitialized !== true
  );
}

interface ReadSettingsResult {
  settings: AppSettings;
  needsMigrationPersist: boolean;
}

async function readSettingsWithMeta(): Promise<ReadSettingsResult> {
  const settingsFile = getSettingsFile();
  try {
    // settingService.get() 会被 UI 和远程会话高频调用。
    // 之前每次读取都把完整配置写入生产日志，导致日志暴涨且暴露路径/配置细节；普通读取只保留开发态 debug。
    debugLog("reading settings from:", settingsFile);
    const raw = await readFile(settingsFile, "utf-8");
    let rawValue: unknown;
    try {
      rawValue = JSON.parse(raw);
    } catch (parseError) {
      let lastParseError: unknown = parseError;
      // setting.json 可能正被另一次 update 覆盖写入，读者会短暂读到半截 JSON。
      // 先做短重试，只有连续失败才按坏文件隔离，避免把正常会话配置误清成默认值。
      for (let retryAttempt = 1; retryAttempt <= SETTINGS_PARSE_RETRY_COUNT; retryAttempt += 1) {
        await delay(SETTINGS_PARSE_RETRY_DELAY_MS);
        try {
          rawValue = JSON.parse(await readFile(settingsFile, "utf-8"));
          break;
        } catch (retryParseError) {
          lastParseError = retryParseError;
        }
      }
      if (rawValue === undefined) {
        await quarantineCorruptSettingsFile(settingsFile, lastParseError);
        return {
          settings: defaultSettings(),
          needsMigrationPersist: false,
        };
      }
    }
    const result = appSettingsSchema.safeParse(rawValue);
    if (!result.success) {
      log(
        "read failed schema validation, returning defaults. error:",
        formatZodError(result.error),
      );
      return {
        settings: defaultSettings(),
        needsMigrationPersist: false,
      };
    }
    debugLog("read result:", JSON.stringify(result.data));
    // D4：成功解析到真实落盘配置后更新日志对照缓存（只作日志用途）。
    lastKnownSettings = result.data;
    return {
      settings: result.data,
      needsMigrationPersist: shouldPersistSettingsMigrations(rawValue),
    };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      debugLog("settings file missing, using defaults");
      return {
        settings: defaultSettings(),
        needsMigrationPersist: false,
      };
    }

    // 文件解析失败等异常兜底返回默认值
    log("read failed, returning defaults. error:", err);
    return {
      settings: defaultSettings(),
      needsMigrationPersist: false,
    };
  }
}

async function readSettings(): Promise<AppSettings> {
  return (await readSettingsWithMeta()).settings;
}

async function writeSettings(
  settings: AppSettings,
  shouldCommit: () => boolean = () => true,
  runExclusiveCommit: (commit: () => Promise<void>) => Promise<void> = (commit) => commit(),
  enterCommitPhase: () => void = () => undefined,
): Promise<void> {
  const settingsDir = getSettingsDir();
  const settingsFile = getSettingsFile();
  // Windows 下测试只改了 HOME，模块顶层常量如果在导入时就把 homedir() 固化，
  // 后续读写仍会串到真实用户目录。这里改成每次按当前环境解析配置路径，保证本地和测试都稳定。
  // D4（specs/log-diagnostics-hygiene.md）：此前每次写盘都全量 dump（~65KB/天且含路径
  // 等细节）；改为每日一条脱敏快照 + 当日增量行。
  logSettingsWrite(settings);
  maybeThrowInjectedFsFault({ operation: "mkdir", path: settingsDir });
  await mkdir(settingsDir, { recursive: true });
  if (!shouldCommit()) return;
  maybeThrowInjectedFsFault({ operation: "writeFile", path: settingsFile });
  // P1：旧 Team 连接导入与 providerFamilyConnectionSelections 字段一起删除，写入不再回滚旧键。
  const persisted = { ...settings };
  await atomicWriteText(settingsFile, JSON.stringify(persisted, null, 2), {
    beforeRename: () => {
      if (!shouldCommit()) {
        // 提交前超时的旧写只能清理临时文件，不能晚到 rename 覆盖新语言偏好。
        throw new Error("stale settings write skipped before atomic rename");
      }
      enterCommitPhase();
    },
    runRename: (renameFile) =>
      runExclusiveCommit(async () => {
        if (!shouldCommit()) throw new Error("stale settings write skipped before atomic rename");
        await renameFile();
      }),
  });
  // D4：写盘成功后推进日志对照缓存（增量 diff 的旧值来源）。
  lastKnownSettings = settings;
  log("write done");
}

export function createSettingService(): ISettingService {
  let updateQueue = Promise.resolve();
  let commitQueue = Promise.resolve();
  let writeQueueGeneration = 0;

  const runSettingsCommit = async (commit: () => Promise<void>) => {
    const queued = commitQueue.then(commit, commit);
    commitQueue = queued.catch(() => {});
    await queued;
  };

  const enqueueSettingsWrite = async (
    runUpdate: (shouldCommit: () => boolean, enterCommitPhase: () => void) => Promise<void>,
  ) => {
    const runCurrentUpdate = () => {
      const currentGeneration = ++writeQueueGeneration;
      const shouldCommit = () => currentGeneration === writeQueueGeneration;
      return withSettingsWriteQueueTimeout(
        (enterCommitPhase) => runUpdate(shouldCommit, enterCommitPhase),
        () => {
          if (writeQueueGeneration === currentGeneration) {
            writeQueueGeneration += 1;
          }
        },
      );
    };
    const queued = updateQueue.then(
      () => runCurrentUpdate(),
      () => runCurrentUpdate(),
    );
    updateQueue = queued.catch(() => {});
    await queued;
  };

  const service: ISettingService = {
    async get(): Promise<AppSettings> {
      // 设置切换后可能立即创建或冷恢复 Session；读取若越过已入队写入，
      // runtime 会固定旧开关值。先等待现有写队列，保证启动偏好读取到已提交的选择。
      await updateQueue;
      const result = await readSettingsWithMeta();
      if (!result.needsMigrationPersist) {
        return result.settings;
      }

      await enqueueSettingsWrite(async (shouldCommit, enterCommitPhase) => {
        const latest = await readSettingsWithMeta();
        if (!latest.needsMigrationPersist) {
          return;
        }

        // 初始化原因：旧版设置可能已把无法区分来源的默认值落盘；升级后按 schema 统一迁移一次。
        // 迁移写盘必须进入 updateQueue，并在队列内重读最新文件，避免覆盖并发保存的其他设置。
        await writeSettings(latest.settings, shouldCommit, runSettingsCommit, enterCommitPhase);
      });

      return readSettings();
    },

    async update(patch: Partial<AppSettings>): Promise<void> {
      const runUpdate = async (shouldCommit: () => boolean, enterCommitPhase: () => void) => {
        const validatedPatch = appSettingsPatchSchema.parse(normalizeSettingsPatch(patch));
        const current = await readSettings();
        const merged = appSettingsSchema.parse({
          ...current,
          ...validatedPatch,
        });

        // 打开工作区后会几乎同时写 recentProjects 和 lastWorkspaceSession。
        // 之前两个 update 都是基于各自读到的旧 settings 直接覆盖写回，
        // 后写入的补丁会把前一个字段整块抹掉，导致下次启动恢复不到会话。
        // 这里把写入串行化，让每个补丁都基于上一次真正落盘后的最新状态继续合并。
        if (merged.recentProjects) {
          merged.recentProjects = [...new Set(merged.recentProjects)].slice(0, MAX_RECENT_PROJECTS);
        }

        await writeSettings(merged, shouldCommit, runSettingsCommit, enterCommitPhase);
      };

      await enqueueSettingsWrite(runUpdate);
    },

    async updateDataBaseDir(newDir: string | undefined): Promise<void> {
      const currentBaseDir = getDataBaseDir();
      const targetBaseDir = newDir?.trim() || homedir();
      const validation = validateDataBaseDirTarget(targetBaseDir);
      if (!validation.ok) {
        // Windows 安装目录由安装器/自动更新管理，把 .zcode/v2 放进去可能在升级时被覆盖。
        // 迁移前在 service 层拦截，避免 UI 入口变化或 RPC 调用绕过前端判断。
        const error = new Error(`${validation.code}: ${validation.forbiddenDir}`);
        (error as Error & { code: string }).code = validation.code;
        throw error;
      }

      if (currentBaseDir !== targetBaseDir) {
        log("copying data directory from", currentBaseDir, "to", targetBaseDir);
        await copyDataDirectory(currentBaseDir, targetBaseDir);
        log("data directory copy done");
      }

      await this.update({ dataBaseDir: newDir });
    },

    async ensureDefaultProject(userHomeDir: string): Promise<{ path: string; created: boolean }> {
      const path = join(userHomeDir, DEFAULT_PROJECT_NAME);
      let existedBefore = true;

      try {
        await access(path).catch(() => {
          existedBefore = false;
        });
        maybeThrowInjectedFsFault({ operation: "mkdir", path });
        await mkdir(path, { recursive: true });
      } catch (error) {
        log("ensureDefaultProject failed:", error);
        throw error;
      }

      return { path, created: !existedBefore };
    },
  };

  return service;
}
