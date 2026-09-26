// 自托管服务器令牌登录的纯逻辑与探测函数（specs/onboarding-and-gate.md 第 4 条）。
// 两条硬约束：
// 1. 登录判定只依据 fetch 的 HTTP 状态码——WebSocket 报错没有状态码，
//    拿它做登录跳转判定会形成回环（invariant: Web login must never create a redirect loop）。
// 2. 令牌只允许出现在探测请求的 URL 上，绝不写入日志或 localStorage。

const SERVER_ORIGIN_STORAGE_KEY = "zcode.web.serverOrigin";
const SERVER_TOKEN_PROBE_TIMEOUT_MS = 10_000;

/** 启动门禁结论：已登录 / 需要登录 / 交回原有启动流程（服务器不可达等情况）。 */
type ServerTokenGateDecision = "authenticated" | "login-required" | "defer-to-bootstrap";

/** 提交令牌后的探测结论：成功（Cookie 已由服务端写入）/ 令牌错误 / 无法连接。 */
type ServerTokenProbeOutcome = "authenticated" | "invalid-token" | "unreachable";

function classifyServerTokenGateStatus(status: number): ServerTokenGateDecision {
  if (status >= 200 && status < 300) {
    return "authenticated";
  }
  if (status === 401) {
    return "login-required";
  }
  return "defer-to-bootstrap";
}

function classifyServerTokenProbeStatus(status: number): ServerTokenProbeOutcome {
  if (status >= 200 && status < 300) {
    return "authenticated";
  }
  if (status === 401) {
    return "invalid-token";
  }
  return "unreachable";
}

function buildServerTokenProbeUrl(origin: string, token: string): string {
  return `${origin}/api/server-info?token=${encodeURIComponent(token)}`;
}

/** 归一化用户输入的服务器地址：去掉首尾空白与结尾斜杠，仅接受 http(s) origin。 */
export function normalizeServerOriginInput(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/u, "");
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * 持久化决策（纯函数）：选中的地址与当前 origin 相同则返回 null（清除存储，避免残留无效条目），
 * 不同则返回应写入的 origin。
 */
function resolveServerOriginPersistence(
  currentOrigin: string,
  chosenOrigin: string,
): string | null {
  return chosenOrigin === currentOrigin ? null : chosenOrigin;
}

export function loadPersistedServerOrigin(currentOrigin: string): string | null {
  try {
    const stored = window.localStorage.getItem(SERVER_ORIGIN_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    const normalized = normalizeServerOriginInput(stored);
    if (!normalized || normalized === currentOrigin) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

export function savePersistedServerOrigin(currentOrigin: string, chosenOrigin: string): void {
  const value = resolveServerOriginPersistence(currentOrigin, chosenOrigin);
  try {
    if (value) {
      window.localStorage.setItem(SERVER_ORIGIN_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(SERVER_ORIGIN_STORAGE_KEY);
    }
  } catch {
    // localStorage 被禁用（隐私模式等）时静默降级：持久化只用于记忆地址，不应阻断登录。
  }
}

/**
 * 启动门禁探测：不带 token、同源携带 Cookie。已有有效 Cookie → 200（已登录）；
 * 未登录 → 401（进登录页）；服务器不可达 → 交回原有启动流程——服务器宕机不是登录问题，
 * 后续 WS 连接失败会走既有的启动错误 UI。
 */
export async function probeWebServerTokenGate(): Promise<ServerTokenGateDecision> {
  try {
    const response = await fetch("/api/server-info", {
      cache: "no-store",
      credentials: "same-origin",
    });
    return classifyServerTokenGateStatus(response.status);
  } catch {
    return "defer-to-bootstrap";
  }
}

/** 提交令牌后的同源探测：200 时服务端已下发 `zcode_lite_token` HttpOnly Cookie；10s 超时视为不可达。 */
export async function probeServerToken(
  origin: string,
  token: string,
): Promise<ServerTokenProbeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_TOKEN_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(buildServerTokenProbeUrl(origin, token), {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    return classifyServerTokenProbeStatus(response.status);
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timer);
  }
}
