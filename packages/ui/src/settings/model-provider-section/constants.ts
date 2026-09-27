import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";

// P3 C4 供应商 family/specs 删除：PRESET_PROVIDER_SPECS / CODING_PLAN_PROVIDER_SPECS
// （zai/bigmodel 账号 provider 目录）、CodingPlan* 状态类型与套餐权益状态形状
// 已随设置页 de-plan 移除；设置页只保留中性的 preset/custom 管理导航类型。

export function resolveModelProviderDisplayName(
  provider: Pick<ProviderSettingsFormProvider, "providerId" | "config">,
): string {
  return getProviderFormLabel(provider);
}

export type ModelProviderNavItem =
  | {
      key: string;
      type: "preset";
      presetId: string;
      label: string;
      provider: ProviderSettingsFormProvider | null;
      displayName: string;
      statusActive: boolean;
    }
  | {
      key: string;
      type: "custom";
      label: string;
      provider: ProviderSettingsFormProvider;
      statusActive: boolean;
    };

export type ModelProviderNavGroupId = "preset" | "custom";

export interface ModelProviderNavGroup {
  id: ModelProviderNavGroupId;
  title: string;
  items: ModelProviderNavItem[];
}
