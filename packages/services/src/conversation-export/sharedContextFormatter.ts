/**
 * P5 W4b：本地会话 Markdown 导出格式化器。
 *
 * 从原 conversation-share/sharedContextFormatter.ts（formatSharedContextV1）扩展：
 * - subagent/hookInvocation 行改为渲染（summary + 子会话 notice / fenced JSON），
 *   不再抛错（W4a 种子里这两类直接 throw，导出必须能整会话落盘）；
 * - artifact 引用只保留 display name + MIME + 本地/相对路径（或文件名）行，
 *   已删除的 `zcode-artifact://share/` 装配语义（installedArtifacts 查表 + 前缀剥离）
 *   不再进入导出；artifact bundling 按 D-P5.7 推迟到 v2；
 * - 「未知 row kind 不得静默消失」的 unsupportedKinds 纪律与 markdownSha256 摘要保持不变。
 */
import { createHash } from "node:crypto";

import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";

interface ConversationExportFormatterInput {
  title: string;
  rows: ConversationRow[];
}

interface ConversationExportDocument {
  formatterVersion: 1;
  markdown: string;
  markdownSha256: string;
  /** 本 build 认不出、没能进 Markdown 的 row kind；调用方负责记日志。 */
  unsupportedKinds: string[];
}

function fenced(value: string): string {
  const fence = value.includes("```") ? "````" : "```";
  return `${fence}\n${value}\n${fence}`;
}

/** 历史行可能仍携带已删除的分享 artifact scheme；只保留尾部 id/文件名用于展示。 */
function displayArtifactRef(ref: string): string {
  const shareSchemePrefix = "zcode-artifact://share/";
  return ref.startsWith(shareSchemePrefix) ? ref.slice(shareSchemePrefix.length) : ref;
}

function renderUserInputRow(row: Extract<ConversationRow, { kind: "userInput" }>): string {
  const attachmentLines = (row.attachments ?? []).map((attachment) =>
    [
      `- ${attachment.fileName}`,
      `  - Path: ${displayArtifactRef(attachment.ref)}`,
      `  - MIME: ${attachment.mime}`,
    ].join("\n"),
  );
  return `## User\n\n${row.text}${
    attachmentLines.length > 0 ? `\n\n### Attachments\n\n${attachmentLines.join("\n")}` : ""
  }`;
}

function renderSubagentRow(row: Extract<ConversationRow, { kind: "subagent" }>): string {
  const lines = [`## Subagent: ${row.subagentType}`];
  if (row.summaryText.trim()) {
    lines.push("", row.summaryText.trim());
  }
  lines.push("", `- Status: ${row.status}`);
  if (row.childSessionId) {
    // row 形状不内嵌 child rows（childSessionId 仅指向可下钻订阅的子会话）；
    // 必须留 notice，避免读者以为子代理完整过程已在导出内。
    lines.push(`- Child session: ${row.childSessionId}`);
    lines.push("- The child conversation is not embedded in this export.");
  }
  return lines.join("\n");
}

function renderHookInvocationRow(
  row: Extract<ConversationRow, { kind: "hookInvocation" }>,
): string {
  // hookExecutionProjection 已是 client-safe 摘要（无命令/绝对路径/stdio），整段 fenced 落盘。
  const payload = {
    hookEventName: row.hookEventName,
    state: row.state,
    lane: row.lane,
    ...(row.durationMs !== undefined ? { durationMs: row.durationMs } : {}),
    executions: row.executions,
  };
  return `## Hook Invocation: ${row.hookEventName}\n\n${fenced(JSON.stringify(payload, null, 2))}`;
}

export function formatConversationExportV1(
  input: ConversationExportFormatterInput,
): ConversationExportDocument {
  const title = input.title.trim();
  const sections = [`# ZCode session${title ? `: ${title}` : ""}`];
  const unsupportedKinds = new Set<string>();
  for (const row of input.rows) {
    switch (row.kind) {
      case "turnHeader":
        break;
      case "userInput":
        sections.push(renderUserInputRow(row));
        break;
      case "assistantText":
        sections.push(`## Assistant\n\n${row.text}`);
        break;
      case "reasoning":
        sections.push(`## Reasoning\n\n${row.text}`);
        break;
      case "toolCall":
        sections.push(
          `## Tool: ${row.toolName}\n\n### Input\n\n${fenced(row.inputText)}${
            row.output?.text ? `\n\n### Output\n\n${fenced(row.output.text)}` : ""
          }`,
        );
        break;
      case "timelineMarker":
        sections.push(`## Timeline\n\n${fenced(JSON.stringify(row.marker))}`);
        break;
      case "artifact": {
        sections.push(
          [
            `## Artifact: ${row.displayName}`,
            `- Path: ${displayArtifactRef(row.ref)}`,
            `- MIME: ${row.mimeType}`,
          ].join("\n"),
        );
        break;
      }
      case "subagent":
        sections.push(renderSubagentRow(row));
        break;
      case "hookInvocation":
        sections.push(renderHookInvocationRow(row));
        break;
      default:
        // 未来新增的 row kind：不抛（一行认不出不该让整次导出失败），但也不能静默——
        // 模型侧少内容必须留痕，否则只能靠用户发现回答漏了东西。
        unsupportedKinds.add((row as { kind?: string }).kind ?? "unknown");
        break;
    }
  }
  const markdown = `${sections.join("\n\n")}\n`;
  return {
    formatterVersion: 1,
    markdown,
    markdownSha256: createHash("sha256").update(markdown, "utf8").digest("hex"),
    unsupportedKinds: [...unsupportedKinds],
  };
}
