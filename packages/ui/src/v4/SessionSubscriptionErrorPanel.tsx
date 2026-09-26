import { useCallback } from "react";
import { TID_V4_RETRY_SUBSCRIBE } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { buildErrorFeedbackContext } from "@/lib/externalFeedbackContext.js";

interface SessionSubscriptionErrorPanelProps {
  error: string;
  sessionId: string;
  workspacePath: string;
  onReconnect: () => void;
}

export function SessionSubscriptionErrorPanel({
  error,
  sessionId,
  workspacePath,
  onReconnect,
}: SessionSubscriptionErrorPanelProps) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  // P2：订阅失败的反馈改为外部 GitHub Issues，正文预填脱敏后的报错与 session / 工作区线索。
  const handleOpenFeedback = useCallback(async () => {
    const context = buildErrorFeedbackContext({
      message: error,
      contextLines: [
        intl.formatMessage({ id: "subscription.error.reportIssue.sessionId" }, { id: sessionId }),
        intl.formatMessage(
          { id: "subscription.error.reportIssue.workspace" },
          { path: workspacePath },
        ),
      ],
    });
    await platform.openFeedback(context);
    toast(intl.formatMessage({ id: "chat.error.feedbackOpened" }));
  }, [error, intl, platform, sessionId, workspacePath]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-ui-base">
      <p className="max-w-full break-words text-center font-mono text-destructive">{error}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" variant="outline" onClick={handleOpenFeedback}>
          {intl.formatMessage({ id: "chat.error.feedback" })}
        </Button>
        <Button type="button" data-testid={TID_V4_RETRY_SUBSCRIBE} onClick={onReconnect}>
          {intl.formatMessage({ id: "workspaceSidebar.reconnect" })}
        </Button>
      </div>
    </div>
  );
}
