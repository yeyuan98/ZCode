import { useEffect, useState, useCallback } from "react";

export type Theme = "light" | "dark" | "zcode-light" | "zcode-dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "zcode-theme";
const BROWSER_THEME_SURFACE_ATTRIBUTE = "data-zcode-browser-theme-surface";

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") {
    return getSystemTheme();
  }

  return theme === "dark" || theme === "zcode-dark" ? "dark" : "light";
}

export function normalizeThemePreference(theme: Theme): Theme {
  if (theme === "dark") return "zcode-dark";
  if (theme === "light") return "zcode-light";
  return theme;
}

function setThemeMetaContent(name: "theme-color" | "color-scheme", content: string) {
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
    document.head.append(meta);
  }
  meta.content = content;
}

function syncBrowserThemeSurface(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (
    typeof root.hasAttribute !== "function" ||
    !root.hasAttribute(BROWSER_THEME_SURFACE_ATTRIBUTE)
  ) {
    return;
  }

  // Electron 为 vibrancy 保持透明根背景，但普通浏览器需要从文档根和标准 meta
  // 获得页面主题。只切换 React 的 dark class 会让浏览器工具栏、原生控件和 overscroll 留在旧主题。
  root.setAttribute(BROWSER_THEME_SURFACE_ATTRIBUTE, resolved);
  root.style.colorScheme = resolved;
  setThemeMetaContent("color-scheme", resolved);

  const background = getComputedStyle(root).getPropertyValue("--color-background").trim();
  if (background) {
    setThemeMetaContent("theme-color", background);
  }
}

export function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme);
  const appliedTheme =
    theme === "system"
      ? resolved === "dark"
        ? "zcode-dark"
        : "zcode-light"
      : normalizeThemePreference(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.classList.toggle("theme-zcode-light", appliedTheme === "zcode-light");
  document.documentElement.classList.toggle("theme-zcode-dark", appliedTheme === "zcode-dark");
  syncBrowserThemeSurface(resolved);
}

function isTheme(value: string | null): value is Theme {
  return (
    value === "light" ||
    value === "dark" ||
    value === "zcode-light" ||
    value === "zcode-dark" ||
    value === "system"
  );
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    // 默认主题统一收敛到 zcode-dark，避免旧 hook 兜底值和 Zustand store 默认值分叉。
    // P4 主题标识由 zai-* 重命名为 zcode-*：旧持久化值通不过 isTheme，会落到此处兜底并重置为默认主题。
    return isTheme(saved) ? normalizeThemePreference(saved) : "zcode-dark";
  });

  const setTheme = useCallback((t: Theme) => {
    const normalizedTheme = normalizeThemePreference(t);
    localStorage.setItem(STORAGE_KEY, normalizedTheme);
    setThemeState(normalizedTheme);
    applyTheme(normalizedTheme);
  }, []);

  // 初始化 + system 模式下监听系统偏好变化
  useEffect(() => {
    applyTheme(theme);

    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return { theme, setTheme } as const;
}
