import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";

import {
  ConversationExportService,
  createConversationExportService,
} from "../src/conversation-export/conversationExportService.js";
import {
  ConversationExportError,
  readConversationExportErrorKind,
} from "../src/conversation-export/conversationExportError.js";
import {
  collectShareStructureIssues,
  type ConversationStructureIssue,
} from "../src/conversation-export/conversationStructureIssues.js";
import { formatConversationExportV1 } from "../src/conversation-export/sharedContextFormatter.js";
import { createServiceLogger } from "../src/logger/serviceLogger.js";

// P5 W4b：本地导出测试矩阵——formatter 行类型覆盖（subagent/hookInvocation 渲染、
// artifact 引用、未知 kind notice、markdownSha256 稳定性）、在役守卫、
// 服务 happy path（fake agent pick 分页 + 标题回落）与文件名 slug。

interface RowBase {
  rowId: number;
  turnId: string;
  productTurnId?: string;
  createdAt?: number;
  createdAtSeq?: number;
}

function baseRow(input: RowBase) {
  return {
    rowId: input.rowId,
    turnId: input.turnId,
    ...(input.productTurnId ? { productTurnId: input.productTurnId } : {}),
    createdAt: input.createdAt ?? 0,
    createdAtSeq: input.createdAtSeq ?? input.rowId,
  };
}

function turnHeader(input: RowBase & { state?: string }): ConversationRow {
  return {
    ...baseRow(input),
    kind: "turnHeader",
    origin: "userInput",
    state: (input.state ?? "completedSuccess") as "completedSuccess",
    startedAt: 0,
  } as ConversationRow;
}

function userInput(input: RowBase & { text: string; origin?: string }): ConversationRow {
  return {
    ...baseRow(input),
    kind: "userInput",
    text: input.text,
    origin: (input.origin ?? "realUser") as "realUser",
  } as ConversationRow;
}

function assistantText(input: RowBase & { text: string }): ConversationRow {
  return {
    ...baseRow(input),
    kind: "assistantText",
    text: input.text,
    state: "complete",
  } as ConversationRow;
}

function reasoning(input: RowBase & { text: string }): ConversationRow {
  return {
    ...baseRow(input),
    kind: "reasoning",
    text: input.text,
    state: "complete",
  } as ConversationRow;
}

function toolCall(
  input: RowBase & { toolName: string; inputText: string; outputText?: string },
): ConversationRow {
  return {
    ...baseRow(input),
    kind: "toolCall",
    toolCallId: `tool-${input.rowId}`,
    toolName: input.toolName,
    status: "success",
    inputText: input.inputText,
    ...(input.outputText ? { output: { text: input.outputText } } : {}),
  } as ConversationRow;
}

function subagent(
  input: RowBase & { status?: string; summaryText?: string; childSessionId?: string },
): ConversationRow {
  return {
    ...baseRow(input),
    kind: "subagent",
    subagentType: "general-purpose",
    status: (input.status ?? "success") as "success",
    summaryText: input.summaryText ?? "Subagent finished the research.",
    ...(input.childSessionId ? { childSessionId: input.childSessionId } : {}),
  } as ConversationRow;
}

function hookInvocation(input: RowBase & { state?: string }): ConversationRow {
  return {
    ...baseRow(input),
    kind: "hookInvocation",
    hookInvocationId: `hook-${input.rowId}`,
    hookEventName: "PreToolUse",
    hookCount: 1,
    state: (input.state ?? "completed") as "completed",
    startedAt: 0,
    lane: "toolBefore",
    executions: [
      {
        hookRunId: "run-1",
        hookIndex: 0,
        didExecute: true,
        state: "completed",
        outcome: "success",
        startedAt: 0,
        endedAt: 10,
        durationMs: 10,
        displayName: "lint-check",
        sourceKind: "project",
      },
    ],
  } as ConversationRow;
}

function artifactRow(input: RowBase & { ref?: string }): ConversationRow {
  return {
    ...baseRow(input),
    kind: "artifact",
    artifactVersionId: "artifact-1",
    logicalArtifactKey: "report",
    displayName: "Quarterly Report",
    artifactType: "md",
    mimeType: "text/markdown",
    sizeBytes: 128,
    sha256: "a".repeat(64),
    ref: input.ref ?? "artifacts/report.md",
    state: "current",
  } as ConversationRow;
}

function conversationFixture(): ConversationRow[] {
  return [
    turnHeader({ rowId: 1, turnId: "t1", productTurnId: "p1" }),
    userInput({ rowId: 2, turnId: "t1", productTurnId: "p1", text: "Summarize the repo." }),
    assistantText({ rowId: 3, turnId: "t1", productTurnId: "p1", text: "Here is the summary." }),
  ];
}

test("formatter: 基础行 user/assistant/reasoning/tool 渲染", () => {
  const rows = [
    ...conversationFixture(),
    reasoning({ rowId: 4, turnId: "t1", productTurnId: "p1", text: "Thinking..." }),
    toolCall({
      rowId: 5,
      turnId: "t1",
      productTurnId: "p1",
      toolName: "read_file",
      inputText: '{"path":"a.md"}',
      outputText: "file body",
    }),
  ];
  const document = formatConversationExportV1({ title: "Repo 概览", rows });
  assert.match(document.markdown, /^# ZCode session: Repo 概览/u);
  assert.match(document.markdown, /## User\n\nSummarize the repo\./u);
  assert.match(document.markdown, /## Assistant\n\nHere is the summary\./u);
  assert.match(document.markdown, /## Reasoning\n\nThinking\.\.\./u);
  assert.match(document.markdown, /## Tool: read_file\n\n### Input\n\n```/u);
  assert.match(document.markdown, /### Output\n\n```\nfile body\n```/u);
  assert.deepEqual(document.unsupportedKinds, []);
  assert.equal(document.formatterVersion, 1);
  assert.match(document.markdownSha256, /^[0-9a-f]{64}$/u);
});

test("formatter: markdownSha256 对相同输入稳定", () => {
  const rows = conversationFixture();
  const first = formatConversationExportV1({ title: "t", rows });
  const second = formatConversationExportV1({ title: "t", rows });
  assert.equal(first.markdownSha256, second.markdownSha256);
  assert.equal(first.markdown, second.markdown);
});

test("formatter: subagent 行渲染 summary/status/child notice（不再抛错）", () => {
  const rows = [
    ...conversationFixture(),
    subagent({ rowId: 4, turnId: "t1", productTurnId: "p1", childSessionId: "child-1" }),
  ];
  const document = formatConversationExportV1({ title: "t", rows });
  assert.match(document.markdown, /## Subagent: general-purpose/u);
  assert.match(document.markdown, /Subagent finished the research\./u);
  assert.match(document.markdown, /- Status: success/u);
  assert.match(document.markdown, /- Child session: child-1/u);
  assert.match(document.markdown, /- The child conversation is not embedded in this export\./u);
  assert.deepEqual(document.unsupportedKinds, []);
});

test("formatter: hookInvocation 行渲染 fenced JSON（不再抛错）", () => {
  const rows = [
    ...conversationFixture(),
    hookInvocation({ rowId: 4, turnId: "t1", productTurnId: "p1" }),
  ];
  const document = formatConversationExportV1({ title: "t", rows });
  assert.match(
    document.markdown,
    /## Hook Invocation: PreToolUse\n\n```\n\{\n  "hookEventName": "PreToolUse"/u,
  );
  assert.match(document.markdown, /"displayName": "lint-check"/u);
  assert.deepEqual(document.unsupportedKinds, []);
});

test("formatter: artifact 行保留 display name/MIME/本地路径，删除 share scheme 语义", () => {
  const rows = [
    ...conversationFixture(),
    artifactRow({
      rowId: 4,
      turnId: "t1",
      productTurnId: "p1",
      ref: "zcode-artifact://share/art-123",
    }),
  ];
  const document = formatConversationExportV1({ title: "t", rows });
  assert.match(document.markdown, /## Artifact: Quarterly Report/u);
  assert.match(document.markdown, /- Path: art-123/u);
  assert.match(document.markdown, /- MIME: text\/markdown/u);
  assert.doesNotMatch(document.markdown, /zcode-artifact:\/\//u);
});

test("formatter: userInput 附件渲染文件名/路径/MIME", () => {
  const rows: ConversationRow[] = [
    turnHeader({ rowId: 1, turnId: "t1", productTurnId: "p1" }),
    {
      ...baseRow({ rowId: 2, turnId: "t1", productTurnId: "p1" }),
      kind: "userInput",
      text: "see attachment",
      origin: "realUser",
      attachments: [
        {
          ref: "workspace/report.md",
          fileName: "report.md",
          mime: "text/markdown",
          bytes: 12,
        },
      ],
    } as ConversationRow,
  ];
  const document = formatConversationExportV1({ title: "t", rows });
  assert.match(document.markdown, /### Attachments\n\n- report\.md/u);
  assert.match(document.markdown, /- Path: workspace\/report\.md/u);
  assert.match(document.markdown, /- MIME: text\/markdown/u);
});

test("formatter: 未知 row kind 进入 unsupportedKinds notice 而不是静默消失", () => {
  const unknownRow = {
    ...baseRow({ rowId: 4, turnId: "t1", productTurnId: "p1" }),
    kind: "futureRowKind",
  } as unknown as ConversationRow;
  const document = formatConversationExportV1({
    title: "t",
    rows: [...conversationFixture(), unknownRow],
  });
  assert.deepEqual(document.unsupportedKinds, ["futureRowKind"]);
});

test("在役守卫：运行中轮次/流式行/活跃工具/子代理触发 conversation_running", () => {
  const runningRows: ConversationRow[] = [
    turnHeader({ rowId: 1, turnId: "t1", productTurnId: "p1", state: "running" }),
    userInput({ rowId: 2, turnId: "t1", productTurnId: "p1", text: "hi" }),
  ];
  const issues = collectShareStructureIssues(runningRows).filter(
    (issue: ConversationStructureIssue) =>
      [
        "running_turn",
        "streaming_row",
        "active_tool_call",
        "active_subagent",
        "unsupported_timeline",
      ].includes(issue.code),
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, "running_turn");

  const service = createConversationExportService({
    zcodeAgentService: fakeRowsAgent([runningRows]),
    logger: silentLogger(),
  });
  return assert.rejects(
    service.exportConversation({ workspacePath: "/w", sessionId: "s1" }),
    (error: unknown) => {
      assert.ok(error instanceof ConversationExportError);
      assert.equal(error.kind, "conversation_running");
      assert.equal(readConversationExportErrorKind(error), "conversation_running");
      return true;
    },
  );
});

test("readConversationExportErrorKind: 非导出错误返回 undefined", () => {
  assert.equal(readConversationExportErrorKind(new Error("boom")), undefined);
  assert.equal(readConversationExportErrorKind({ kind: "other" }), undefined);
  assert.equal(readConversationExportErrorKind(null), undefined);
});

function fakeRowsAgent(pages: ConversationRow[][]): {
  conversationRowsRangeV4: (params: { beforeRowId?: number; limit?: number }) => Promise<{
    rows: ConversationRow[];
    hasMore: boolean;
    atLogEpoch: string;
    atRevision: number;
  }>;
} {
  return {
    async conversationRowsRangeV4(params) {
      const page = pages[0]!;
      return {
        rows: page,
        hasMore: pages.length > 1,
        atLogEpoch: "epoch-1",
        atRevision: 7,
        ...(params.beforeRowId === undefined && pages.length > 1 ? {} : {}),
      };
    },
  };
}

test("服务 happy path：分页合并 + 标题读取 + slug 文件名 + sha256 摘要", async () => {
  const pageOne = [
    turnHeader({ rowId: 3, turnId: "t1", productTurnId: "p1" }),
    assistantText({ rowId: 4, turnId: "t1", productTurnId: "p1", text: "answer" }),
  ];
  const pageTwo = [
    turnHeader({ rowId: 1, turnId: "t0", productTurnId: "p0" }),
    userInput({ rowId: 2, turnId: "t0", productTurnId: "p0", text: "question" }),
  ];
  const agent = {
    async conversationRowsRangeV4(params: { beforeRowId?: number }) {
      const page = params.beforeRowId === undefined ? pageOne : pageTwo;
      return {
        rows: page,
        hasMore: params.beforeRowId === undefined,
        atLogEpoch: "epoch-1",
        atRevision: 7,
      };
    },
  };
  const service = new ConversationExportService({
    zcodeAgentService: agent,
    zcodeSessionService: {
      async readSession() {
        return {
          session: { title: "Fix: 登录超时/Bug #42" },
        } as never;
      },
    },
    logger: silentLogger(),
  });
  const result = await service.exportConversation({ workspacePath: "/w", sessionId: "s1" });
  assert.match(result.fileName, /^zcode-session-Fix-登录超时-Bug-#42\.md$/u);
  assert.match(result.markdown, /## User\n\nquestion/u);
  assert.match(result.markdown, /## Assistant\n\nanswer/u);
  // 行序按 rowId 全局升序（分页倒读 unshift 合并）。
  assert.ok(result.markdown.indexOf("question") < result.markdown.indexOf("answer"));
});

test("服务：标题读取失败时文件名回落 sessionId", async () => {
  const service = new ConversationExportService({
    zcodeAgentService: fakeRowsAgent([conversationFixture()]),
    zcodeSessionService: {
      async readSession() {
        throw new Error("session not found");
      },
    },
    logger: silentLogger(),
  });
  const result = await service.exportConversation({ workspacePath: "/w", sessionId: "abc-123" });
  assert.equal(result.fileName, "zcode-session-abc-123.md");
});

test("服务：slug 清理非法字符并截断", async () => {
  const service = new ConversationExportService({
    zcodeAgentService: fakeRowsAgent([conversationFixture()]),
    zcodeSessionService: {
      async readSession() {
        return { session: { title: 'a<b>:c|"d?e*f  g' } } as never;
      },
    },
    logger: silentLogger(),
  });
  const result = await service.exportConversation({ workspacePath: "/w", sessionId: "s1" });
  assert.equal(result.fileName, "zcode-session-a-b-c-d-e-f-g.md");
});

function silentLogger() {
  return createServiceLogger("conversation-export-test", { sink: { ...console, debug: () => {} } });
}
