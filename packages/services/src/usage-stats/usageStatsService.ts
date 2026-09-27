import type { AppUsageRequest, AppUsageSnapshot } from "@zcode/shared";
import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import type { IUsageStatsService } from "./usageStats.js";

// P3 供应商套餐/配额面删除：BigModel/Z.AI 的 quota monitor、Coding Plan 用量、
// 额度重置与 entitlement provider（providers/* 六个文件）已删除；
// 服务只保留 App Usage（agent 数据库真实统计，经 ZCode Protocol 读取）。

interface UsageStatsServiceDependencies {
  /** App Usage 经 ZCode Protocol 读取 agent 数据库真实统计。 */
  zcodeAgentService: Pick<IZCodeAgentService, "getAppUsageStats">;
}

export function createUsageStatsService(
  dependencies: UsageStatsServiceDependencies,
): IUsageStatsService {
  return {
    async getAppUsageSnapshot(request: AppUsageRequest): Promise<AppUsageSnapshot> {
      // App Usage 现读取 agent 数据库真实统计（model_usage/turn_usage/tool_usage），
      // 经 ZCode Protocol usage/stats 取回。不再读本地 session JSON 估算。
      return dependencies.zcodeAgentService.getAppUsageStats({
        range: request.range,
        timeZone: request.timeZone,
      });
    },
  };
}
