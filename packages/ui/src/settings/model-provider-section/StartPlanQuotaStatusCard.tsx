// P3 S2 过渡：vendor quota 形状改自 UI 本地过渡模块（C4 de-plan 时移除）。
import type { UsageQuotaLimit } from "@/lib/usageQuotaShapes.js";
import { StartPlanBalanceCard } from "@/settings/model-provider-section/StartPlanBalanceCard.js";

export function StartPlanQuotaStatusCard({
  isChecking,
  limits,
  expireTime,
  embedded = false,
}: {
  isChecking: boolean;
  limits: UsageQuotaLimit[];
  expireTime?: string | null;
  embedded?: boolean;
}) {
  return (
    <StartPlanBalanceCard
      isChecking={isChecking}
      limits={limits}
      expireTime={expireTime}
      embedded={embedded}
    />
  );
}
