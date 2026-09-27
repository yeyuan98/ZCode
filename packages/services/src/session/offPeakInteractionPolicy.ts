// 闲时免打扰策略（P3 binding policy）的 turn 级归因注册表。
// 从 desktop host 抽到 services：host 派发成功登记、终态/订阅释放摘除；
// zcodeAgentService 在 permission/AskUserQuestion/plan-approval 反向请求处询问。
// 归因严格按「该 session 的活跃 turn 属于闲时派发」——无在场检测，
// Run-now 也不豁免（交互需求由普通任务承载）。
export interface OffPeakInteractionPolicy {
  /** sendPrompt 已接受：本次闲时 turn 成为该会话的活跃 turn，登记免打扰归因。 */
  track(sessionId: string): void;
  /** 终态回写完成/订阅释放/会话关闭：摘除归因，恢复普通交互语义。 */
  untrack(sessionId: string): void;
  /** 该 session 的活跃 turn 是否属于闲时派发（true = 交互自动拒绝）。 */
  shouldDecline(sessionId: string): boolean;
}

export function createOffPeakInteractionPolicy(): OffPeakInteractionPolicy {
  const activeTurnSessions = new Set<string>();
  return {
    track: (sessionId) => {
      activeTurnSessions.add(sessionId);
    },
    untrack: (sessionId) => {
      activeTurnSessions.delete(sessionId);
    },
    shouldDecline: (sessionId) => activeTurnSessions.has(sessionId),
  };
}
