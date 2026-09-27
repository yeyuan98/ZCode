// P3 C4 供应商账号删除：Plan Card / Coding Plan 状态面板 / Team Plan 分支 /
// ProviderFamily 连接模式头部已随设置页 de-plan 整体移除；详情页只保留
// preset（目录内置，只读端点、不可改名）与 custom（可编辑、可删除）两种中性表单。
import {
  getProviderFormApiKeyManagementUrl,
  type ProviderSettingsFormProvider,
} from "@/lib/providerSettingsFormTypes.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ModelProviderNavItem } from "./constants.js";
import { InlineEditableProviderCard } from "./InlineEditableProviderCard.js";
import { ModelProviderLoadingCard, PresetProviderPlaceholderCard } from "./StatusCards.js";
import type { SavePersonalModelDraftInput } from "@zcode/provider";
import type { ModelConnectivityResult } from "@zcode/shared";

export function ModelProviderSectionDetail({
  selectedNavItem,
  presetLoading,
  onSave,
  onAddPersonalModel,
  onSavePersonalModelDraft,
  onSetPersonalModelEnabled,
  onDeletePersonalModel,
  onDelete,
  onReorderProviderModels,
  onTestModel,
  onOpenApiKeyUrl,
}: {
  selectedNavItem: ModelProviderNavItem | null;
  presetLoading: boolean;
  onSave: (config: ProviderSettingsFormProvider) => void | Promise<void>;
  onAddPersonalModel?: (
    providerId: string,
    modelId: string,
    config: ProviderSettingsFormProvider["models"][number]["personalConfig"],
    useRecommendedConfig?: boolean,
  ) => Promise<unknown>;
  onSavePersonalModelDraft?: (input: SavePersonalModelDraftInput) => Promise<unknown>;
  onSetPersonalModelEnabled?: (
    providerId: string,
    modelId: string,
    enabled: boolean,
  ) => Promise<unknown>;
  onDeletePersonalModel?: (providerId: string, modelId: string) => Promise<unknown>;
  onDelete: (provider: ProviderSettingsFormProvider) => Promise<void>;
  onReorderProviderModels?: (providerId: string, modelIds: string[]) => Promise<void>;
  onTestModel: (providerId: string, modelId: string) => Promise<ModelConnectivityResult>;
  onOpenApiKeyUrl: (url: string) => void;
}) {
  const { intl } = useZCodeIntl();
  const loadingLabel = intl.formatMessage({ id: "common.loading" });
  // 所有详情共用同一套模型操作装配，preset/custom 只差端点与改名的可编辑性。
  const modelEditingProps = {
    onAddPersonalModel,
    onSavePersonalModelDraft,
    onSetPersonalModelEnabled,
    onDeletePersonalModel,
  };

  if (!selectedNavItem) {
    return <ModelProviderLoadingCard loadingLabel={loadingLabel} />;
  }

  if (selectedNavItem.type === "preset") {
    if (!selectedNavItem.provider) {
      // 首屏慢网时预置供应商配置尚未返回，之前这里会直接展示“尚未同步”，
      // 用户会把“还在下载”误判成“当前账号未登录”。首刷期间改为明确显示 loading，
      // 等请求结束后再决定是否展示未同步占位。
      if (presetLoading) {
        return <ModelProviderLoadingCard loadingLabel={loadingLabel} />;
      }

      return <PresetProviderPlaceholderCard displayName={selectedNavItem.displayName} />;
    }

    const presetProvider = selectedNavItem.provider;

    return (
      <InlineEditableProviderCard
        provider={presetProvider}
        onSave={onSave}
        {...modelEditingProps}
        onReorderModelIds={
          onReorderProviderModels
            ? (modelIds) => onReorderProviderModels(presetProvider.providerId, modelIds)
            : undefined
        }
        onTestModel={onTestModel}
        readOnlyEndpoints
        // 预置供应商名称承载固定 API Key 入口语义，
        // 允许重命名会让侧边栏和模型选择器展示含义不一致，因此只允许自定义供应商改名。
        nameEditable={false}
      />
    );
  }

  if (!selectedNavItem.provider) {
    return <ModelProviderLoadingCard loadingLabel={loadingLabel} />;
  }

  const customProvider = selectedNavItem.provider;
  const customApiKeyUrl = customProvider.templateId
    ? getProviderFormApiKeyManagementUrl(customProvider)
    : undefined;
  return (
    // 仅展示预设模板声明的入口，不根据地址猜测自定义 Provider 的 Key 控制台。
    <InlineEditableProviderCard
      provider={customProvider}
      onSave={onSave}
      {...modelEditingProps}
      onDelete={() => onDelete(customProvider)}
      onReorderModelIds={
        onReorderProviderModels
          ? (modelIds) => onReorderProviderModels(customProvider.providerId, modelIds)
          : undefined
      }
      onTestModel={onTestModel}
      presetApiKeyUrl={customApiKeyUrl}
      readOnlyEndpoints={false}
      nameEditable
      onOpenPresetApiKey={
        customApiKeyUrl
          ? () => {
              onOpenApiKeyUrl(customApiKeyUrl);
            }
          : undefined
      }
    />
  );
}
