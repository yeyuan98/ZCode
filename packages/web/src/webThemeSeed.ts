type WebThemeSeed = "light" | "dark" | "zcode-light" | "zcode-dark" | "system";

export const WEB_DEFAULT_THEME: WebThemeSeed = "zcode-dark";

function isWebThemeSeed(value: unknown): value is WebThemeSeed {
  return (
    value === "light" ||
    value === "dark" ||
    value === "zcode-light" ||
    value === "zcode-dark" ||
    value === "system"
  );
}

function normalizeWebThemeSeed(theme: WebThemeSeed): WebThemeSeed {
  if (theme === "dark") return "zcode-dark";
  if (theme === "light") return "zcode-light";
  return theme;
}

export function resolveWebInitialTheme({
  storedTheme,
  defaultTheme = WEB_DEFAULT_THEME,
}: {
  storedTheme?: string | null;
  defaultTheme?: WebThemeSeed;
}): WebThemeSeed {
  if (isWebThemeSeed(storedTheme)) {
    return normalizeWebThemeSeed(storedTheme);
  }

  return normalizeWebThemeSeed(defaultTheme);
}
