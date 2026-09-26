import type { ProviderSettingsView } from "@zcode/services";

type ProviderTemplatePickerTemplate = ProviderSettingsView["providerTemplates"][number];

interface ProviderTemplateGroup {
  readonly id: "all";
  readonly templates: readonly ProviderTemplatePickerTemplate[];
}

/**
 * 模板分组：P2 起向导与设置页共用同一份内置目录，所有厂商平铺为单一中性列表，
 * 不再保留任何厂商专属分组。
 */
export function resolveProviderTemplateGroups(
  templates: readonly ProviderTemplatePickerTemplate[],
): readonly ProviderTemplateGroup[] {
  return [{ id: "all", templates }];
}
