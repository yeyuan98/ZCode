import assert from "node:assert/strict";
import test from "node:test";
import {
  buildErrorFeedbackContext,
  buildTaskFeedbackContext,
} from "../src/lib/externalFeedbackContext.ts";

test("error context redacts the title like the body", () => {
  // 标题会进入 URL 查询参数/浏览器历史，错误信息里的本地路径必须脱敏。
  const context = buildErrorFeedbackContext({
    message: "failed to read /home/alice/secret/config.json",
    detail: "ENOENT at /home/alice/secret/config.json",
    traceId: "trace-1",
  });
  assert.equal(context.title.includes("alice"), false);
  assert.match(context.title, /\[USER_PATH\]/);
  assert.equal(context.body.includes("alice"), false);
  assert.match(context.body, /TraceID: trace-1/);
});

test("error context truncates long titles but keeps the redaction prefix", () => {
  const context = buildErrorFeedbackContext({ message: "x".repeat(500) });
  assert.equal(context.title.length <= 80, true);
});

test("error context omits optional sections instead of leaving blank placeholders", () => {
  const context = buildErrorFeedbackContext({ message: "boom" });
  assert.equal(context.body.includes("TraceID"), false);
  assert.equal(context.body.includes("Error detail"), false);
});

test("task context redacts workspace and session paths in the body", () => {
  const context = buildTaskFeedbackContext({
    title: "反馈任务问题",
    taskTitle: "refactor C:\\work\\zcode module",
    taskId: "task-9",
    workspacePath: "/srv/workspaces/demo",
    taskSessionPath: "/srv/workspaces/demo/.zcode/session",
    taskLogPath: null,
  });
  assert.equal(context.body.includes("srv"), false);
  // Windows 盘符前缀同样被归一为 [USER_PATH]。
  assert.match(context.body, /\[USER_PATH\]/);
  assert.match(context.body, /Task ID: task-9/);
  assert.equal(context.body.includes("Log:"), false);
});
