import { createRoot } from "react-dom/client";
import type { ResourceUsageSnapshot, StorageManagementBridge } from "@zcode/shared";
import "@zcode/ui/styles.css";
import {
  ResourceManagerApp,
  ZCodeIntlProvider,
  applyUiFontSizePx,
  loadUiFontSizePx,
  subscribeToUiFontSizeStorageChanges,
} from "@zcode/ui";

declare global {
  interface Window {
    resourceManager?: {
      getSnapshot: () => Promise<ResourceUsageSnapshot>;
      setSamplingActive: (active: boolean) => void;
      storage?: StorageManagementBridge;
    };
  }
}

type Theme = "light" | "dark" | "zcode-light" | "zcode-dark" | "system";

function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme === "dark" || theme === "zcode-dark" ? "dark" : "light";
}

function applyResourceManagerTheme(): void {
  const savedTheme = (localStorage.getItem("zcode-theme") as Theme | null) ?? "zcode-dark";
  const resolvedTheme = resolveTheme(savedTheme);
  const appliedTheme =
    savedTheme === "system"
      ? resolvedTheme === "dark"
        ? "zcode-dark"
        : "zcode-light"
      : savedTheme === "dark"
        ? "zcode-dark"
        : savedTheme === "light"
          ? "zcode-light"
          : savedTheme;
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  document.documentElement.classList.toggle("theme-zcode-light", appliedTheme === "zcode-light");
  document.documentElement.classList.toggle("theme-zcode-dark", appliedTheme === "zcode-dark");
}

applyResourceManagerTheme();
// 资源管理器不创建主窗口的 Zustand store，text-ui-* 无法自动获得持久化基准。
// 首屏前显式应用，运行中再由 storage 事件同步，且不改变 html font-size 或接入业务 Host。
applyUiFontSizePx(loadUiFontSizePx());
subscribeToUiFontSizeStorageChanges();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    // 语言沿用主窗口写入 localStorage 的偏好；不接 settingService，避免独立窗口再起一份 RPC。
    <ZCodeIntlProvider>
      <ResourceManagerApp
        setSamplingActive={window.resourceManager?.setSamplingActive}
        getSnapshot={
          window.resourceManager ? () => window.resourceManager!.getSnapshot() : undefined
        }
        storage={window.resourceManager?.storage}
      />
    </ZCodeIntlProvider>,
  );
}
