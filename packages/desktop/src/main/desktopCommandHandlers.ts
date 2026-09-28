/* eslint-disable max-lines -- 桌面命令分发需要共享窗口与平台上下文，集中维护更便于一致性 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";
import {
  DesktopCommandIds,
  PlatformChannels,
  type AppSettings,
  type DesktopCommandId,
  type Locale,
  ZCODE_PRODUCT_FLAVOR,
  buildGitHubIssueUrl,
  getCommunityUrlFromConfig,
  resolveHelpAppConfig,
  type OpenFeedbackContext,
} from "@zcode/shared";
import { readZCodeStdioTapDevState, setZCodeStdioTapDevEnabled } from "@zcode/services/node";
import { showAboutDialog } from "./about.js";
import { checkForUpdateMenuClick } from "./autoUpdater.js";
import { exportLogs } from "./exportLogs.js";
import { openResourceManager } from "./resourceManagerWindow.js";
import { resolveCuaOsSupport } from "./cuaOsSupport.js";
import { syncWindowControlsOverlayForZoomLevel } from "./desktopWindowButtonPosition.js";
import {
  DEFAULT_DESKTOP_WINDOW_HEIGHT,
  DEFAULT_DESKTOP_WINDOW_WIDTH,
} from "./desktopWindowSize.js";
import {
  clampDesktopZoomLevel,
  resolveDesktopZoomFactorForLevel,
  resolveDesktopZoomLevelFromFactor,
} from "./desktopZoom.js";

export const HELP_TOGGLE_DEV_TOOLS_MENU_ID = "help.toggle-dev-tools";
export const HELP_TOGGLE_ZCODE_STDIO_TAP_MENU_ID = "help.toggle-zcode-stdio-tap";
// P5 D-P5.4：ZCode Endpoint 自定义输入窗（prompt 窗 + 尺寸常量）已随帮助菜单
// Endpoint 选择器删除。

function resolveTargetWindow(senderWindow?: BrowserWindow | null) {
  if (senderWindow && !senderWindow.isDestroyed()) {
    return senderWindow;
  }

  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}
function updateDesktopZoomLevel(
  targetWindow: BrowserWindow | null | undefined,
  action: "reset" | "in" | "out",
) {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  const currentLevel = resolveDesktopZoomLevelFromFactor(targetWindow.webContents.getZoomFactor());
  const nextLevel =
    action === "reset" ? 0 : clampDesktopZoomLevel(currentLevel + (action === "in" ? 1 : -1));

  // 系统缩放快捷键需要可用，但不能无限放大/缩小导致界面失控。
  // Electron zoomLevel 的真实比例是 1.2^level；这里改用 zoomFactor，保证每档统一为 1.1。
  targetWindow.webContents.setZoomFactor(resolveDesktopZoomFactorForLevel(nextLevel));
  syncWindowControlsOverlayForZoomLevel(targetWindow, nextLevel);
  targetWindow.webContents.send(PlatformChannels.DesktopZoomLevelChanged, { zoomLevel: nextLevel });
  return nextLevel;
}

// P5 D-P5.4：showMessageBoxWithOptionalParent（仅剩 Custom Endpoint 错误弹窗消费）已随
// Endpoint 选择器删除。
async function clearAllDataAndRelaunch(options: {
  credentialsDir: string;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}) {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Cancel", "Clear All"],
    defaultId: 0,
    cancelId: 0,
    title: "Clear All Data",
    message: "确定要清除所有数据吗？",
    detail:
      "将删除 ~/.zcode/v2（配置、凭据、日志）和浏览器缓存（localStorage）。操作不可恢复，清除后应用将自动重启。",
  });
  if (response !== 1) {
    return;
  }

  const { rm } = await import("node:fs/promises");
  try {
    await rm(options.credentialsDir, { recursive: true, force: true });
    options.logger.info("[clear-all-data] deleted ~/.zcode/v2");
  } catch (error) {
    options.logger.error("[clear-all-data] failed to delete ~/.zcode/v2:", error);
  }

  for (const win of BrowserWindow.getAllWindows()) {
    try {
      await win.webContents.executeJavaScript("localStorage.clear()");
    } catch {
      // 窗口可能已经销毁，忽略
    }
  }

  try {
    const session = BrowserWindow.getAllWindows()[0]?.webContents.session;
    if (session) {
      await session.clearStorageData();
      options.logger.info("[clear-all-data] cleared session storage data");
    }
  } catch (error) {
    options.logger.error("[clear-all-data] failed to clear session data:", error);
  }

  app.relaunch();
  app.exit(0);
}

// P3 C2 供应商套餐/计费面删除：clearCodingPlanWebviewStorage（官网购买 webview 的
// persist:zcode-coding-plan 独立 partition 清理）已随购买链路移除，ClearAllData
// 只清理默认 session 与凭据目录。

// P2：远端 /api/v1/client/configs 帮助配置拉取随供应商反馈通道移除（specs/onboarding-and-gate.md 第 5 条），
// 反馈与社群入口统一只读打包内置的 config/default.json。

function resolveLocalAppConfigPath(options?: {
  appPath?: string;
  isPackaged?: boolean;
  resourcesPath?: string;
}): string {
  const isPackaged = options?.isPackaged ?? app.isPackaged;
  if (isPackaged) {
    // app.getAppPath() 在正式包中指向 resources/app.asar，向上两级后会误读
    // Contents/config。内置配置由 electron-builder 放在 resources/config，必须从 resourcesPath 解析。
    return join(options?.resourcesPath ?? process.resourcesPath, "config/default.json");
  }
  return join(options?.appPath ?? app.getAppPath(), "../../config/default.json");
}

async function readLocalAppConfig(readLocalConfig?: () => unknown): Promise<unknown> {
  const localConfigPath = resolveLocalAppConfigPath();
  return readLocalConfig?.() ?? JSON.parse(await readFile(localConfigPath, "utf-8"));
}

export async function resolveCommunityUrl(options: {
  locale: Locale;
  readLocalConfig?: () => unknown;
  logger: {
    warn: (...args: unknown[]) => void;
  };
}): Promise<string | undefined> {
  let localConfig: unknown;
  try {
    localConfig = await readLocalAppConfig(options.readLocalConfig);
  } catch (error) {
    options.logger.warn("[community] failed to read local config:", error);
  }

  return getCommunityUrlFromConfig(localConfig, options.locale);
}

/**
 * P2：反馈入口统一为外部 GitHub Issues 跳转。内置反馈中心（OpenFeedbackDialog IPC、
 * feedbackService）已删除；context（错误摘要 / 任务 id）经 buildGitHubIssueUrl 以
 * title/body 查询参数预填到 new-issue 页。
 */
export async function openFeedbackExternal(options: {
  logger: {
    warn: (...args: unknown[]) => void;
  };
  context?: OpenFeedbackContext;
  readLocalConfig?: () => unknown;
}) {
  let localConfig: unknown;
  try {
    localConfig = await readLocalAppConfig(options.readLocalConfig);
  } catch (error) {
    options.logger.warn("[feedback] failed to read local config:", error);
  }
  const config = resolveHelpAppConfig(localConfig);
  await shell.openExternal(
    buildGitHubIssueUrl({
      baseUrl: config.feedback_url,
      title: options.context?.title,
      body: options.context?.body,
    }),
  );
}

async function openCommunity(
  locale: Locale,
  logger: {
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  },
) {
  const communityUrl = await resolveCommunityUrl({ locale, logger });
  if (!communityUrl) {
    logger.warn("[community] community_urls is missing from local config");
    return;
  }
  await shell.openExternal(communityUrl);
}

// P5 D-P5.4：以下整块删除（endpoint web 硬切）——
// promptCustomZCodeEndpoint / escapeHtmlAttribute / buildZCodeEndpointPromptHtml /
// showZCodeEndpointPromptWindow（自定义 endpoint 输入窗）、setZCodeEndpointOverride
// （设置写入）、resolveChangelogUrl 的 endpoint 分流与 resolveCurrentZCodeEndpointOrigin。

async function persistDesktopZoomLevel(options: {
  zoomLevel: number;
  logger: { warn: (...args: unknown[]) => void };
  settingService: { update(patch: Pick<AppSettings, "desktopZoomLevel">): Promise<void> };
}) {
  try {
    // 桌面缩放命令原本只改当前 BrowserWindow，重启后没有任何恢复来源。
    // 这里在命令成功后把夹取后的档位写入 setting.json，让快捷键、View 菜单和侧边栏菜单共享同一持久化事实源。
    await options.settingService.update({ desktopZoomLevel: options.zoomLevel });
  } catch (error) {
    options.logger.warn("[desktop-zoom] persist zoom level failed:", error);
  }
}

function toggleZCodeStdioTapDevProxy(options: {
  logger: { info: (...args: unknown[]) => void };
  updateZCodeStdioTapDevMenuState: () => void;
}) {
  const current = readZCodeStdioTapDevState();
  const next = setZCodeStdioTapDevEnabled(!current.enabled);
  options.updateZCodeStdioTapDevMenuState();
  options.logger.info("[stdio-tap] dev proxy toggled", {
    enabled: next.enabled,
    visible: next.visible,
    logDir: next.logDir,
  });
}

// P5 D-P5.4：changelog 外链由供应商 endpoint web（{ZCODE}/cn|/en/changelog，按应用语言分流）
// 改为本仓库 GitHub Releases 页；endpoint 解析链删除后不再有语言分流。
export async function openChangelog(): Promise<void> {
  await shell.openExternal("https://github.com/yeyuan98/zodex/releases");
}

export async function executeDesktopCommand(options: {
  command: DesktopCommandId;
  senderWindow?: BrowserWindow | null;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  updateZCodeStdioTapDevMenuState: () => void;
  onDesktopZoomChanged?: (zoomLevel: number) => Promise<void> | void;
  onRelaunchApp: () => Promise<void>;
  settingService: {
    get(): Promise<Pick<AppSettings, "desktopZoomLevel">>;
    update(patch: Partial<Pick<AppSettings, "desktopZoomLevel">>): Promise<void>;
  };
  credentialsDir: string;
  currentApplicationLocale: Locale;
}) {
  const targetWindow = resolveTargetWindow(options.senderWindow);
  options.logger.info(
    `[desktop-command] execute ${options.command} windowId=${targetWindow?.id ?? "<none>"}`,
  );

  switch (options.command) {
    case DesktopCommandIds.NewTask:
      targetWindow?.webContents.send(PlatformChannels.NewTask);
      return;
    case DesktopCommandIds.OpenWorkspace:
      targetWindow?.webContents.send(PlatformChannels.OpenWorkspace);
      return;
    case DesktopCommandIds.CloseActiveContext:
      targetWindow?.webContents.send(PlatformChannels.CloseActiveContextRequest);
      return;
    case DesktopCommandIds.CloseWindow:
      targetWindow?.close();
      return;
    case DesktopCommandIds.MinimizeWindow:
      targetWindow?.minimize();
      return;
    case DesktopCommandIds.ToggleMaximizeWindow:
      if (targetWindow?.isMaximized()) {
        targetWindow.unmaximize();
      } else {
        targetWindow?.maximize();
      }
      return;
    case DesktopCommandIds.ToggleFullScreen:
      if (targetWindow) {
        targetWindow.setFullScreen(!targetWindow.isFullScreen());
      }
      return;
    case DesktopCommandIds.ResetWindowSize:
      if (targetWindow) {
        if (targetWindow.isFullScreen()) targetWindow.setFullScreen(false);
        if (targetWindow.isMaximized()) targetWindow.unmaximize();
        targetWindow.setSize(DEFAULT_DESKTOP_WINDOW_WIDTH, DEFAULT_DESKTOP_WINDOW_HEIGHT, true);
      }
      return;
    case DesktopCommandIds.ResetZoom:
      {
        const nextZoomLevel = updateDesktopZoomLevel(targetWindow, "reset");
        if (nextZoomLevel !== undefined) {
          await persistDesktopZoomLevel({
            zoomLevel: nextZoomLevel,
            logger: options.logger,
            settingService: options.settingService,
          });
          await options.onDesktopZoomChanged?.(nextZoomLevel);
        }
      }
      return;
    case DesktopCommandIds.ZoomIn:
      {
        const nextZoomLevel = updateDesktopZoomLevel(targetWindow, "in");
        if (nextZoomLevel !== undefined) {
          await persistDesktopZoomLevel({
            zoomLevel: nextZoomLevel,
            logger: options.logger,
            settingService: options.settingService,
          });
          await options.onDesktopZoomChanged?.(nextZoomLevel);
        }
      }
      return;
    case DesktopCommandIds.ZoomOut:
      {
        const nextZoomLevel = updateDesktopZoomLevel(targetWindow, "out");
        if (nextZoomLevel !== undefined) {
          await persistDesktopZoomLevel({
            zoomLevel: nextZoomLevel,
            logger: options.logger,
            settingService: options.settingService,
          });
          await options.onDesktopZoomChanged?.(nextZoomLevel);
        }
      }
      return;
    case DesktopCommandIds.ShowAbout:
      await showAboutDialog(targetWindow ?? undefined, options.currentApplicationLocale);
      return;
    case DesktopCommandIds.OpenChangelog:
      await openChangelog();
      return;
    case DesktopCommandIds.CheckForUpdates:
      // 按产品身份而不是后端环境放行：生产后端的 Preview 同样没有更新器。
      if (ZCODE_PRODUCT_FLAVOR === "production") {
        checkForUpdateMenuClick(targetWindow);
      } else {
        options.logger.info("[auto-update] Preview 已禁用手动更新检查");
      }
      return;
    case DesktopCommandIds.RelaunchApp:
      await options.onRelaunchApp();
      return;
    case DesktopCommandIds.OpenFeedback:
      // P2：原生菜单入口没有 renderer 上下文，直接跳转 GitHub Issues 空白新建页。
      await openFeedbackExternal({ logger: options.logger });
      return;
    case DesktopCommandIds.OpenCommunity:
      await openCommunity(options.currentApplicationLocale, options.logger);
      return;
    case DesktopCommandIds.ExportLogs:
      await exportLogs();
      return;
    case DesktopCommandIds.ToggleDevTools:
      targetWindow?.webContents.toggleDevTools();
      return;
    case DesktopCommandIds.OpenResourceManager:
      openResourceManager();
      return;
    case DesktopCommandIds.ToggleZCodeStdioTapDevProxy:
      toggleZCodeStdioTapDevProxy({
        logger: options.logger,
        updateZCodeStdioTapDevMenuState: options.updateZCodeStdioTapDevMenuState,
      });
      return;
    // P5 D-P5.4：SetZCodeEndpointProduction/Test/Custom 与 ResetZCodeEndpoint 命令
    // 已随帮助菜单 Endpoint 选择器删除（命令 id 一并从 DesktopCommandIds 移除）。
    case DesktopCommandIds.ClearAllData:
      await clearAllDataAndRelaunch({
        credentialsDir: options.credentialsDir,
        logger: options.logger,
      });
      return;
    case DesktopCommandIds.GetCuaOsSupport:
      return resolveCuaOsSupport();
  }
}
