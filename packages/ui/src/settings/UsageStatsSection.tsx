import { AppUsagePanel } from "@/settings/usage-stats/AppUsagePanel.js";

// P3 供应商套餐/配额面删除：使用统计只剩通用 App Usage 单页，
// Coding Plan 多来源 tab 与面板已随 entitlement/monitor 服务面一并删除。
export function UsageStatsSection() {
  return <AppUsagePanel />;
}
