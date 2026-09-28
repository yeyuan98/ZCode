import { FileDownIcon } from "lucide-react";
import { useState } from "react";
import { readConversationExportErrorKind } from "@zcode/services";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { WINDOWS_CAPTION_CONTROL_CLASS } from "@/windowCaptionControls.js";

/**
 * P5 W4b：顶栏「导出会话」入口（specs/conversation-export.md，D-P5.7 整会话导出）。
 *
 * 单击直导（无确认弹层）：服务侧负责时点快照与在役守卫；保存经 IPlatformService.saveFile
 * （桌面原生保存对话框；Web 平台为 Blob 下载兜底）。
 */
export function WorkspaceExportConversationButton({
  sessionId,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  remoteTarget,
  useWindowsCaptionSpacing = false,
}: {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: unknown;
  useWindowsCaptionSpacing?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const services = useWorkspaceServices(
    workspacePath,
    remoteSessionId,
    workspaceIdentity,
    remoteTarget,
  );
  const [exporting, setExporting] = useState(false);
  const actionLabel = intl.formatMessage({ id: "conversationExport.action" });

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    toast(intl.formatMessage({ id: "conversationExport.toast.started" }));
    try {
      const result = await services.conversationExportService.exportConversation({
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(remoteSessionId ? { remoteSessionId } : {}),
        sessionId,
      });
      const saveFile = platform.saveFile;
      if (!saveFile) {
        throw new Error("save_file_unavailable");
      }
      const saveResult = await saveFile({
        data: new TextEncoder().encode(result.markdown).buffer,
        suggestedName: result.fileName,
      });
      if (saveResult.canceled) return;
      if (!saveResult.success) {
        throw new Error(saveResult.error || "save_failed");
      }
      toast(
        intl.formatMessage({ id: "conversationExport.toast.saved" }, { fileName: result.fileName }),
      );
    } catch (error) {
      if (readConversationExportErrorKind(error) === "conversation_running") {
        toast(intl.formatMessage({ id: "conversationExport.error.running" }));
        return;
      }
      logger.warn("[conversation-export] 导出失败", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      toast(intl.formatMessage({ id: "conversationExport.toast.failed" }));
    } finally {
      setExporting(false);
    }
  };

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon-md"
      className={cn(
        "text-foreground hover:bg-hover hover:text-foreground [app-region:no-drag]",
        useWindowsCaptionSpacing ? "ml-3" : "ml-2.5",
        useWindowsCaptionSpacing && WINDOWS_CAPTION_CONTROL_CLASS,
      )}
      aria-label={actionLabel}
      data-testid="conversation-export-trigger"
      disabled={exporting}
      onClick={() => {
        void handleExport();
      }}
    >
      <FileDownIcon className="size-4" />
    </Button>
  );

  return (
    <ControlHintTooltip title={actionLabel} side="bottom">
      {trigger}
    </ControlHintTooltip>
  );
}
