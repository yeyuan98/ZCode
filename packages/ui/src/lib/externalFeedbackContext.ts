import { redactFeedbackText } from "@zcode/shared";

/**
 * P2：内置反馈中心删除后，各反馈入口改为 `platform.openFeedback({ title, body })`
 * 跳转 GitHub Issues 并预填上下文（title/body 对应 new-issue 页的查询参数）。
 * 这里只做纯字符串构建（沿用 redactFeedbackText 脱敏），不做任何 IO。
 */
export interface ExternalFeedbackContext {
  title: string;
  body: string;
}

/** 与旧反馈工单一致的标题截断上限，避免超长错误信息撑爆 issue 标题。 */
const TITLE_MAX_LENGTH = 80;

export function buildErrorFeedbackContext({
  message,
  detail,
  traceId,
  contextLines = [],
}: {
  message: string;
  detail?: string;
  traceId?: string;
  /** 附加排障线索（任务 id / 工作区等），逐行拼接在报错详情之后。 */
  contextLines?: readonly string[];
}): ExternalFeedbackContext {
  return {
    // 标题同样要脱敏：它会成为 URL 查询参数并在点击时进入浏览器历史，
    // 不能让未脱敏的错误信息（可能含本地路径）泄露到标题里。
    title: redactFeedbackText(message).slice(0, TITLE_MAX_LENGTH),
    body: redactFeedbackText(
      [
        message,
        "",
        ...(traceId ? [`TraceID: ${traceId}`] : []),
        detail ? ["", "Error detail:", detail].join("\n") : null,
        contextLines.length > 0 ? ["", ...contextLines].join("\n") : null,
      ]
        .filter((line): line is string => line != null)
        .join("\n"),
    ),
  };
}

export function buildTaskFeedbackContext({
  title,
  taskTitle,
  taskId,
  workspacePath,
  taskSessionPath,
  taskLogPath,
  contextLines = [],
}: {
  /** 已本地化的 issue 标题（如「反馈任务问题：xxx」）；超长由这里统一截断。 */
  title: string;
  taskTitle: string;
  taskId?: string;
  workspacePath: string;
  taskSessionPath?: string | null;
  taskLogPath?: string | null;
  contextLines?: readonly string[];
}): ExternalFeedbackContext {
  return {
    // taskTitle 属于用户数据（任务名可能包含路径），标题侧同样走脱敏。
    title: title.slice(0, TITLE_MAX_LENGTH),
    body: redactFeedbackText(
      [
        "Task Info",
        `- Title: ${redactFeedbackText(taskTitle)}`,
        ...(taskId ? [`- Task ID: ${taskId}`] : []),
        `- Workspace: ${workspacePath}`,
        ...(taskSessionPath ? [`- Session: ${taskSessionPath}`] : []),
        ...(taskLogPath ? [`- Log: ${taskLogPath}`] : []),
        ...(contextLines.length > 0 ? ["", ...contextLines] : []),
      ].join("\n"),
    ),
  };
}
