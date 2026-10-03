import { ZCODE_AGENT_PROVIDER_NOT_READY_CODE } from "@zcode/shared";

type RpcLogLevel = "debug" | "info" | "warn";

/**
 * D1（specs/log-diagnostics-hygiene.md）：高频轮询方法的 OK 行降为 debug（生产不落盘）。
 * 2026-10-02 实测这四个方法占全天日志 63%（20,442/32,515 行）。FAIL 一律 warn 逐条保留；
 * 生产侧存活信号由 rpcLiveness 的 15 分钟汇总补回。
 */
export const RPC_POLL_OK_DEBUG_METHODS: readonly string[] = [
  "bots.getStatus",
  "bots.getConfig",
  "off-peak-task.list",
  "bots.createBindCode",
];

export interface RpcCallSummary {
  method: string;
  ok: boolean;
}

/** 解析 `[rpc:call] <channel>.<command> [→ ]OK|FAIL (…)` 形态；非该形态返回 null。 */
export function parseRpcCallSummary(message: string): RpcCallSummary | null {
  const match = /^\[rpc:call\] (\S+)(?: →)? (OK|FAIL)/.exec(message);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return null;
  }
  return { method: match[1], ok: match[2] === "OK" };
}

/**
 * host 之前把 RPC 日志统一走 error，主日志里看起来像所有 RPC 都失败了。
 * 这里按消息内容做最小分级：FAIL 记 warn，高频输出轮询成功记 debug，其余记 info。
 */
export function resolveRpcLogLevel(message: string, ...args: unknown[]): RpcLogLevel {
  // 后台详情每秒读取一次，成功日志会持续落盘；只降低该查询的成功级别，保留失败诊断。
  if (message.startsWith("[rpc:call] zcode-agent.backgroundBashOutputV4 OK (")) return "debug";

  // workspace 首次绑定时，provider registry 会在 runtime identity 查询之后同步；
  // 这个明确带错误码的失败是启动握手状态，不是服务降级，避免每个 workspace 都留下一条 warn。
  if (
    message.includes("zcode-session.getWorkspaceRuntimeIdentity FAIL") &&
    args.some(
      (arg) =>
        typeof arg === "object" &&
        arg !== null &&
        "code" in arg &&
        (arg as { code?: unknown }).code === ZCODE_AGENT_PROVIDER_NOT_READY_CODE,
    )
  ) {
    return "info";
  }

  const summary = parseRpcCallSummary(message);
  if (summary?.ok && RPC_POLL_OK_DEBUG_METHODS.includes(summary.method)) {
    return "debug";
  }

  return message.includes(" FAIL ") ? "warn" : "info";
}
