/**
 * P5 导出种子（W4a 暂存，W4b 在其上构建 conversation-export 服务）。
 *
 * 从原 conversation-share/sharedContextFormatter.ts 原样迁移。W4b 的导出格式化器
 * 将在 formatSharedContextV1 之上扩展：subagent/hookInvocation 行改为渲染（或带
 * notice 跳过）而不是抛错；`zcode-artifact://share/` 本地/相对路径段落替换为
 * 导出目录引用；「未知 row kind 不得静默消失」的 unsupportedKinds 纪律与
 * markdownSha256 摘要保持不变。
 */
import { createHash } from "node:crypto";

import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";

import { throwConversationExportError } from "./conversationExportError.js";

interface SharedContextFormatterInputV1 {
  share: { shareId: string; title: string };
  rows: ConversationRow[];
  installedArtifacts: Array<{
    artifactId: string;
    workspaceRelativePath: string;
    displayName: string;
    mimeType: string;
    sha256: string;
  }>;
}

interface SharedContextDocumentV1 {
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

export function formatSharedContextV1(
  input: SharedContextFormatterInputV1,
): SharedContextDocumentV1 {
  const paths = new Map(
    input.installedArtifacts.map((artifact) => [artifact.artifactId, artifact]),
  );
  const sections = [`# Shared conversation: ${input.share.title}`];
  const unsupportedKinds = new Set<string>();
  for (const row of input.rows) {
    switch (row.kind) {
      case "turnHeader":
        break;
      case "userInput":
        {
          const attachmentLines = (row.attachments ?? []).flatMap((attachment) => {
            const artifactId = attachment.ref.startsWith("zcode-artifact://share/")
              ? attachment.ref.slice("zcode-artifact://share/".length)
              : "";
            const installed = paths.get(artifactId);
            return installed
              ? [
                  `- ${installed.displayName}`,
                  `  - Path: ${installed.workspaceRelativePath}`,
                  `  - MIME: ${installed.mimeType}`,
                  `  - SHA-256: ${installed.sha256}`,
                ]
              : [];
          });
          sections.push(
            `## User\n\n${row.text}${
              attachmentLines.length > 0
                ? `\n\n### Attachments\n\n${attachmentLines.join("\n")}`
                : ""
            }`,
          );
        }
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
        const artifact = paths.get(row.artifactVersionId);
        if (!artifact) {
          throwConversationExportError(
            "invalid_contract",
            "Shared context artifact was not installed",
          );
        }
        sections.push(
          [
            `## Artifact: ${artifact.displayName}`,
            `- Path: ${artifact.workspaceRelativePath}`,
            `- MIME: ${artifact.mimeType}`,
            `- SHA-256: ${artifact.sha256}`,
          ].join("\n"),
        );
        break;
      }
      case "subagent":
      case "hookInvocation":
        throwConversationExportError(
          "invalid_contract",
          `Unsupported shared context row: ${row.kind}`,
        );
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
