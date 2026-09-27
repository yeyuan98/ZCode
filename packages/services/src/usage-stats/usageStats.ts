import type { AppUsageRequest, AppUsageSnapshot } from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

// P3 供应商套餐/配额面删除：IUsageStatsService 仅保留通用 App Usage 快照；
// Coding Plan 用量/额度重置/entitlement 与 monitor getSnapshot 方法随 vendor 服务面删除。

export interface IUsageStatsService {
  getAppUsageSnapshot(request: AppUsageRequest): Promise<AppUsageSnapshot>;
}

export const IUsageStatsService = createServiceDescriptor<IUsageStatsService>(
  ServiceChannels.UsageStats,
);
