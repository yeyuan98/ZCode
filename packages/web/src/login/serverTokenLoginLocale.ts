type ServerTokenLoginLocale = "zh-CN" | "en-US";

interface ServerTokenLoginPageCopy {
  title: string;
  description: string;
  tokenLabel: string;
  tokenPlaceholder: string;
  serverAddressLabel: string;
  serverAddressHint: string;
  advancedToggleShow: string;
  advancedToggleHide: string;
  submitAction: string;
  submittingAction: string;
  emptyTokenError: string;
  invalidTokenError: string;
  unreachableError: string;
  invalidAddressError: string;
}

const SERVER_TOKEN_LOGIN_COPY = {
  "zh-CN": {
    title: "登录到服务器",
    description: "此服务器已启用访问令牌认证，请输入服务器令牌继续。",
    tokenLabel: "访问令牌",
    tokenPlaceholder: "输入服务器访问令牌",
    serverAddressLabel: "服务器地址",
    serverAddressHint: "更换地址后会跳转到目标服务器完成登录。",
    advancedToggleShow: "更换服务器地址",
    advancedToggleHide: "收起服务器地址",
    submitAction: "登录",
    submittingAction: "正在验证…",
    emptyTokenError: "请输入访问令牌。",
    invalidTokenError: "令牌不正确，请检查后重试。",
    unreachableError: "无法连接服务器，请确认服务正在运行。",
    invalidAddressError: "服务器地址无效，需为 http(s)://host[:port] 形式。",
  },
  "en-US": {
    title: "Sign in to server",
    description: "This server requires an access token. Enter the server token to continue.",
    tokenLabel: "Access token",
    tokenPlaceholder: "Enter the server access token",
    serverAddressLabel: "Server address",
    serverAddressHint: "Changing the address redirects to that server to finish sign-in.",
    advancedToggleShow: "Change server address",
    advancedToggleHide: "Hide server address",
    submitAction: "Sign in",
    submittingAction: "Verifying…",
    emptyTokenError: "Enter the access token.",
    invalidTokenError: "Incorrect token. Check it and try again.",
    unreachableError: "Cannot reach the server. Make sure it is running.",
    invalidAddressError: "Invalid server address. Expected http(s)://host[:port].",
  },
} satisfies Record<ServerTokenLoginLocale, ServerTokenLoginPageCopy>;

// 独立登录页不接 ui 包的 i18n 管线（见 WebCallbackPage 的本地 copy 模式），
// 语言跟随 navigator.language：zh 开头用中文，其余回落英文。
function resolveServerTokenLoginLocale(language?: string): ServerTokenLoginLocale {
  const candidate = language ?? navigator.language ?? "";
  return candidate.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function getServerTokenLoginCopy(
  locale: ServerTokenLoginLocale = resolveServerTokenLoginLocale(),
): ServerTokenLoginPageCopy {
  return SERVER_TOKEN_LOGIN_COPY[locale];
}
