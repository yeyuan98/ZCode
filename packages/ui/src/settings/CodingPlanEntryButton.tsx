import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button.js";

// P3 供应商套餐/配额面删除：购买入口盘点（useCodingPlanEntryPlanList，经升级弹窗
// Provider 下发）已删除；gate 退化为恒 ready，按钮行为不再有 loading/error 分支。
// C4 设置页 de-plan 时随升级入口整体移除。
export function useCodingPlanEntryGate(): {
  status: "loading" | "error" | "ready";
  label: string | undefined;
  retry: (() => void) | undefined;
} {
  return { status: "ready", label: undefined, retry: undefined };
}

/** 各入口共享同一查询状态；失败时按钮只重试，不继续执行购买动作。 */
export function CodingPlanEntryButton({
  children,
  disabled,
  onClick,
  bypassGate = false,
  ...props
}: ComponentProps<typeof Button> & { bypassGate?: boolean }) {
  const gate = useCodingPlanEntryGate();
  const status = bypassGate ? "ready" : gate.status;
  return (
    <Button
      {...props}
      disabled={disabled || status === "loading"}
      aria-label={status === "ready" ? props["aria-label"] : gate.label}
      aria-busy={status === "loading"}
      title={status === "ready" ? props.title : gate.label}
      onClick={(event) => {
        if (status === "error") {
          event.preventDefault();
          event.stopPropagation();
          gate.retry?.();
          return;
        }
        if (status === "ready") onClick?.(event);
      }}
    >
      {status === "ready" ? children : gate.label}
    </Button>
  );
}
