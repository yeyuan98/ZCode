import { useEffect, useMemo } from "react";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { getProviderFormLabel } from "@/lib/providerSettingsFormTypes.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  type ModelProviderNavGroup,
  type ModelProviderNavItem,
} from "@/settings/model-provider-section/constants.js";
import {
  createCustomProviderNodeKey,
  createPresetProviderNodeKey,
} from "@/settings/model-provider-section/utils.js";
import {
  sortModelProvidersForDisplay,
  type ProviderOrderView,
} from "@/lib/modelProviderOrdering.js";

// P3 C4 供应商 family/specs 删除：Coding Plan / Start Plan / Team Plan 导航簇
// （CODING_PLAN_PROVIDER_SPECS、entitlement 状态解析、family 过滤与连接方式回落）
// 已随设置页 de-plan 移除。分组退化为两层中性结构：
// - preset：Registry 目录里非 standard-personal 的内置 provider（模板目录实例）。
// - custom：用户自建 provider（standard-personal），沿用模型菜单的展示排序。

interface UseModelProviderNavigationOptions {
  modelProviders: ProviderSettingsFormProvider[];
  displayOrder?: ProviderOrderView;
  selectedNodeKey: string | null;
  setSelectedNodeKey: (key: string | null) => void;
  intl: ReturnType<typeof useZCodeIntl>["intl"];
}

export function useModelProviderNavigation({
  modelProviders,
  displayOrder,
  selectedNodeKey,
  setSelectedNodeKey,
  intl,
}: UseModelProviderNavigationOptions) {
  const customProviders = useMemo(() => {
    const allCustomProviders = modelProviders.filter(
      (provider) => provider.config.group === "standard-personal",
    );
    // 这里复用模型菜单的展示排序，确保设置页和聊天框供应商顺序一致。
    return sortModelProvidersForDisplay(allCustomProviders, displayOrder);
  }, [displayOrder, modelProviders]);

  const presetProviders = useMemo(
    () =>
      modelProviders.filter(
        (provider) => provider.config.group !== "standard-personal" && !isHiddenProvider(provider),
      ),
    [modelProviders],
  );

  const navigationGroups = useMemo<ModelProviderNavGroup[]>(() => {
    const groups: ModelProviderNavGroup[] = [
      {
        id: "preset",
        title: intl.formatMessage({ id: "settings.modelProvider.presetTitle" }),
        items: presetProviders.map((provider) => ({
          key: createPresetProviderNodeKey(provider.providerId),
          type: "preset" as const,
          presetId: provider.providerId,
          label: getProviderFormLabel(provider),
          provider,
          displayName: getProviderFormLabel(provider),
          statusActive: provider.executable === true,
        })),
      },
      {
        id: "custom",
        title: intl.formatMessage({ id: "settings.modelProvider.customTitle" }),
        items: customProviders.map((provider) => ({
          key: createCustomProviderNodeKey(provider.providerId),
          type: "custom" as const,
          label: getProviderFormLabel(provider),
          provider,
          statusActive: provider.executable === true,
        })),
      },
    ];

    // 目录暂未下发内置 provider 时收起 preset 分组，避免渲染空标题。
    return groups.filter((group) => group.id !== "preset" || group.items.length > 0);
  }, [customProviders, presetProviders, intl]);

  const navigationItems = useMemo(
    () => navigationGroups.flatMap((group) => group.items),
    [navigationGroups],
  );

  const navigationItemByKey = useMemo(
    () => new Map(navigationItems.map((item) => [item.key, item])),
    [navigationItems],
  );

  const selectedNavItem = selectedNodeKey
    ? (navigationItemByKey.get(selectedNodeKey) ?? null)
    : null;

  const fallbackNodeKey = resolveFallbackModelProviderNodeKey(navigationItems);
  useEffect(() => {
    const hasSelectedNode = selectedNodeKey ? navigationItemByKey.has(selectedNodeKey) : false;
    if (hasSelectedNode) {
      return;
    }

    if (selectedNodeKey !== fallbackNodeKey) {
      setSelectedNodeKey(fallbackNodeKey);
    }
  }, [fallbackNodeKey, selectedNodeKey, setSelectedNodeKey, navigationItemByKey]);

  return {
    navigationGroups,
    navigationItems,
    selectedNavItem,
  };
}

function isHiddenProvider(provider: ProviderSettingsFormProvider): boolean {
  // 内置目录允许下发隐藏 provider（仅作为模板/继承基线），不进入设置页导航。
  return provider.config.visibility === "hidden";
}

function resolveFallbackModelProviderNodeKey(
  items: readonly ModelProviderNavItem[],
): string | null {
  // 初始化只在没有有效选中项时发生；如果当前用户选择仍有效，上层 effect 不会调用 fallback 抢焦点。
  return items[0]?.key ?? null;
}
