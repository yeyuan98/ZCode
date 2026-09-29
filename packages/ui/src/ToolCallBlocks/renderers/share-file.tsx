import { memo } from "react";
import { ShareIcon } from "lucide-react";
import { SHARE_FILE_TOOL_NAME } from "@zcode/shared";
import { FileDisplayInline } from "@/lib/fileDisplay.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ToolSnapshotFieldNotice } from "@/ToolCallBlocks/ToolSnapshotFieldNotice.js";
import { ToolLayout } from "@/ToolCallBlocks/ToolLayout.js";
import type { ToolCallBlockRenderContext } from "@/ToolCallBlocks/shared.js";

// ============================================================
// share_file 工具卡（bot 会话文件投递，specs/bot-file-delivery.md Phase B.7）
// ============================================================
// 契约：chip 的文件路径只读工具输入（输入只有 path 一个字段），投递结局只读
// 输出散文（CLI formatModelContent 的成功句 vs 失败原因句）。刻意不解析结构化
// 输出、不新增协议展示字段——结构化 filename/size 展示已明确延后（Alpha 1 契约）。

const SHARE_FILE_TOOL_ICON = <ShareIcon className="size-4 shrink-0 text-foreground-subtle" />;

// CLI 侧 formatShareFileModelContent 的成功句前缀；状态判定只认这行散文。
const SHARE_FILE_SUCCESS_PROSE_PREFIX = "File sent to the bot chat user:";
// unknown-outcome 的散文没有 "nothing was sent" 字样，必须单独识别，
// 否则会被归成「未发送」——而它的事实是结果未知，可能已发出。
const SHARE_FILE_UNKNOWN_PROSE_MARKER = "The delivery outcome is UNKNOWN";

type ShareFileDeliveryStatus = "sent" | "not-sent" | "unknown-outcome";

interface ShareFileDelivery {
  status: ShareFileDeliveryStatus;
  /** 非成功结局时挂到状态词 tooltip 的输出首句；成功不需要 detail。 */
  detail?: string;
}

const SHARE_FILE_STATUS_MESSAGE_IDS: Record<ShareFileDeliveryStatus, string> = {
  sent: "chat.toolCall.shareFile.sent",
  "not-sent": "chat.toolCall.shareFile.notSent",
  "unknown-outcome": "chat.toolCall.shareFile.unknownOutcome",
};

function normalizeToolName(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/gu, "") : "";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isShareFileToolCall(
  toolCall: ToolCallBlockRenderContext["toolCallNode"]["toolCall"],
): boolean {
  // cron/offpeak 同款按名认领：share_file 不在 shared 已知工具表里，
  // 不按名分流会掉进 raw JSON 兜底卡。
  const expected = normalizeToolName(SHARE_FILE_TOOL_NAME);
  return [toolCall.toolName, toolCall.kind, toolCall.title].some(
    (value) => normalizeToolName(value) === expected,
  );
}

function readShareFilePath(
  toolCall: ToolCallBlockRenderContext["toolCallNode"]["toolCall"],
): string | undefined {
  // 输入契约只有 path 一个字段；旧快照裁剪后可能只剩 raw.rawInput/raw.input。
  const raw = isPlainRecord(toolCall.raw) ? toolCall.raw : null;
  const candidates = [
    toolCall.input,
    raw && isPlainRecord(raw.rawInput) ? raw.rawInput : undefined,
    raw && isPlainRecord(raw.input) ? raw.input : undefined,
  ];
  for (const candidate of candidates) {
    if (!isPlainRecord(candidate)) {
      continue;
    }
    const path = candidate.path;
    if (typeof path === "string" && path.trim().length > 0) {
      return path;
    }
  }
  return undefined;
}

function readShareFileOutputProse(
  toolCall: ToolCallBlockRenderContext["toolCallNode"]["toolCall"],
): string | undefined {
  const raw = isPlainRecord(toolCall.raw) ? toolCall.raw : null;
  const rawResult = isPlainRecord(raw?.result) ? raw.result : null;
  const candidates = [
    toolCall.output,
    raw?.rawOutput,
    raw?.output,
    rawResult?.content,
    rawResult?.display,
    toolCall.content,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return undefined;
}

function resolveShareFileDelivery(prose: string | undefined): ShareFileDelivery | undefined {
  if (!prose) {
    return undefined;
  }
  if (prose.startsWith(SHARE_FILE_SUCCESS_PROSE_PREFIX)) {
    return { status: "sent" };
  }
  // tooltip 只需要首句（原因句）；整段散文可能很长，挂 tooltip 会溢出。
  const firstSentenceEnd = prose.indexOf(". ");
  const detail = firstSentenceEnd > 0 ? prose.slice(0, firstSentenceEnd + 1) : prose;
  if (prose.includes(SHARE_FILE_UNKNOWN_PROSE_MARKER)) {
    return { status: "unknown-outcome", detail };
  }
  return { status: "not-sent", detail };
}

export const ShareFileToolCallBlock = memo(function ShareFileToolCallBlock(
  context: ToolCallBlockRenderContext,
) {
  const { intl } = useZCodeIntl();
  const { toolCall } = context.toolCallNode;
  const path = readShareFilePath(toolCall);
  const delivery = resolveShareFileDelivery(readShareFileOutputProse(toolCall));
  const kindLabelId = context.isRunning
    ? "chat.toolCall.shareFile.sending"
    : "chat.toolCall.kind.shareFile";
  // 工具级失败（端口缺失/超时等异常）沿用通用失败状态词；投递失败是正常工具结果，
  // toolCall.status 仍是 completed——只有靠输出散文分流，失败投递才不会被标成「已执行」。
  const toolFailureStatusId =
    toolCall.status === "failed"
      ? "chat.toolCall.status.failed"
      : toolCall.status === "denied"
        ? "chat.toolCall.status.denied"
        : toolCall.status === "stopped"
          ? "chat.toolCall.status.stopped"
          : undefined;
  const statusLabelId = toolFailureStatusId
    ? toolFailureStatusId
    : delivery
      ? SHARE_FILE_STATUS_MESSAGE_IDS[delivery.status]
      : undefined;
  const statusTooltip = toolFailureStatusId
    ? (context.errorText ?? delivery?.detail)
    : delivery && delivery.status !== "sent"
      ? delivery.detail
      : undefined;
  // 芯片复用 FileDisplayInline（renderFileChip 同款视觉：图标 + 文件名叶子 + 截断）。
  const primaryText = path ? (
    <FileDisplayInline
      path={path}
      options={{
        basePath: context.workspacePath,
        className: "inline-flex min-w-0 max-w-full items-center gap-1.5",
        fileNameClassName: "min-w-0 truncate text-foreground-subtle",
      }}
    />
  ) : (
    (toolCall.title ?? SHARE_FILE_TOOL_NAME)
  );

  return (
    <>
      <ToolLayout
        toolId={toolCall.toolId}
        icon={SHARE_FILE_TOOL_ICON}
        showIcon={context.showIcon !== false}
        canToggle={false}
        kindLabel={intl.formatMessage({ id: kindLabelId })}
        sourceLabel={context.sourceLabel}
        primaryText={primaryText}
        statusLabel={statusLabelId != null ? intl.formatMessage({ id: statusLabelId }) : undefined}
        showStatusLabel={statusLabelId != null}
        statusTooltip={statusTooltip}
        showFailureStatus={
          toolFailureStatusId === "chat.toolCall.status.failed" || delivery?.status === "not-sent"
        }
        isRunning={context.isRunning}
        title={path ?? toolCall.title}
      />
      <ToolSnapshotFieldNotice
        refs={toolCall.snapshotRefs ?? []}
        onLoadFullToolCallFields={
          context.onLoadFullToolCallFields
            ? () => context.onLoadFullToolCallFields?.(toolCall.toolId)
            : undefined
        }
      />
    </>
  );
});
