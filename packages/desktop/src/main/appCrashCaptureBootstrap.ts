import { logger } from "./logger.js";
import { initializeCrashCapture, type CrashCapturePaths } from "./desktopCrashCapture.js";

// 须在窗口创建前完成：先由 desktopEarlyDataBaseDirBootstrap 注入 dataBaseDir，再配置 crashDumps。
// 已移除 ARMS 远端 crash 上报：这里始终启用仅本地的 crashReporter（不 upload）。
export const crashCapturePaths: CrashCapturePaths = initializeCrashCapture(logger, false);
