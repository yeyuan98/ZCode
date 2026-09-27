import type { ZCodeOffPeakTask } from "@zcode/shared";

// P3 本地化重构：服务端位次/额度/灰度展示已删除；此处只剩状态脚注与本地标题派生。

export type OffPeakStatusIconKind =
  | "moon"
  | "pause"
  | "spinner"
  | "success"
  | "warning"
  | "stopped";

interface OffPeakStatusFooterPresentation {
  icon: OffPeakStatusIconKind;
  className: string;
  labelId: string;
  labelValues?: Record<string, string>;
}

/**
 * 只同步仍保持自动默认值的创建态标题。
 * locale 切换后不能覆盖用户输入、模板草稿或已保存任务标题。
 */
export function resolveLocalizedOffPeakCreateTitle({
  currentTitle,
  hasInitialTitle,
  isEditing,
  nextDefaultTitle,
  previousDefaultTitle,
  titleTouched,
}: {
  currentTitle: string;
  hasInitialTitle: boolean;
  isEditing: boolean;
  nextDefaultTitle: string;
  previousDefaultTitle: string;
  titleTouched: boolean;
}): string {
  if (isEditing || hasInitialTitle || titleTouched || currentTitle !== previousDefaultTitle) {
    return currentTitle;
  }
  return nextDefaultTitle;
}

/** 闲时卡片状态图标与文案的唯一映射（P3：无位次徽章，queued 只表达等待时间窗）。 */
export function resolveOffPeakStatusFooter(
  task: Pick<ZCodeOffPeakTask, "status">,
): OffPeakStatusFooterPresentation {
  switch (task.status) {
    case "queued":
      return {
        icon: "moon",
        className: "text-idle-task",
        labelId: "offPeak.status.queued",
      };
    case "paused":
      return {
        icon: "pause",
        className: "text-idle-task",
        labelId: "offPeak.status.paused",
      };
    case "running":
      return {
        icon: "spinner",
        className: "text-success",
        labelId: "offPeak.status.running",
      };
    case "completed":
      return {
        icon: "success",
        // 完成是无需继续关注的静态终态，success 高亮会让它比活跃任务更抢眼。
        className: "text-foreground-subtle",
        labelId: "offPeak.status.completed",
      };
    case "failed":
      return {
        icon: "warning",
        className: "text-destructive",
        labelId: "offPeak.status.failed",
      };
    case "cancelled":
      return {
        icon: "stopped",
        className: "text-foreground-subtle",
        labelId: "offPeak.status.cancelled",
      };
  }
}

/** 终态任务不会再被调度，不能把历史选择失效显示成当前待修复错误。 */
export function shouldShowOffPeakModelSelectionIssue(
  status: Pick<ZCodeOffPeakTask, "status">["status"],
): boolean {
  return status === "queued" || status === "paused" || status === "running";
}
