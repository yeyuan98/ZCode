import type { Event } from "@zcode/rpc";
import { ServiceChannels } from "@zcode/shared";
import {
  isApiKeyAccess,
  type InitialModelEntry,
  type ModelConfigObject,
  type ModelId,
  type ModelSelection,
  type ModelSelectionFacade,
  type ModelSelectionView,
  type ModelSelectionViewInput,
  type ProviderConfigObject,
  type ProviderId,
  type ProviderSettingsFacade,
  type ProviderSettingsCreationResult,
  type ModelConfigResolution,
  type ProviderSettingsView,
  type ResolveModelConfigInput,
  type SavePersonalModelDraftInput,
} from "@zcode/provider";
import { createServiceDescriptor } from "../descriptors.js";
import type { ModelConnectivityResult } from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import {
  discoverModelsForEndpoint,
  discoverTemplateModels,
  type DiscoverModelsForEndpointInput,
  type DiscoverTemplateModelsFetch,
  type DiscoverTemplateModelsInput,
  type DiscoverTemplateModelsResult,
} from "./providerModelDiscovery.js";

export type {
  ProviderSettingsProviderView,
  ModelSelectionView,
  ModelSelectionViewInput,
  ProviderSettingsView,
} from "@zcode/provider";
export type {
  DiscoveryModelHints,
  DiscoverModelsForEndpointInput,
  DiscoverTemplateModelsInput,
  DiscoverTemplateModelsResult,
} from "./providerModelDiscovery.js";

export interface IProviderSettingsService {
  readonly onDidChange: Event<ProviderSettingsView>;
  getView(): Promise<ProviderSettingsView>;
  refresh(reason: string): Promise<ProviderSettingsView>;
  createPersonalProvider(
    input?: Parameters<ProviderSettingsFacade["createPersonalProvider"]>[0],
  ): Promise<ProviderSettingsCreationResult>;
  resolveModelConfig(input: ResolveModelConfigInput): Promise<ModelConfigResolution>;
  savePersonalProviderOverlay(
    providerId: ProviderId,
    config: ProviderConfigObject,
    metadata?: Parameters<ProviderSettingsFacade["savePersonalProviderOverlay"]>[2],
  ): Promise<ProviderSettingsView>;
  deletePersonalProvider(providerId: ProviderId): Promise<ProviderSettingsView>;
  reorderPersonalProviders(providerIds: readonly ProviderId[]): Promise<ProviderSettingsView>;
  reorderPersonalModels(
    providerId: ProviderId,
    modelIds: readonly ModelId[],
  ): Promise<ProviderSettingsView>;
  addPersonalModel(
    providerId: ProviderId,
    modelId: ModelId,
    config: ModelConfigObject,
    useRecommendedConfig?: boolean,
  ): Promise<ProviderSettingsView>;
  renamePersonalModel(
    providerId: ProviderId,
    currentModelId: ModelId,
    nextModelId: ModelId,
  ): Promise<ProviderSettingsView>;
  deletePersonalModel(providerId: ProviderId, modelId: ModelId): Promise<ProviderSettingsView>;
  savePersonalModelDraft(input: SavePersonalModelDraftInput): Promise<ProviderSettingsView>;
  setPersonalModelEnabled(
    providerId: ProviderId,
    modelId: ModelId,
    enabled: boolean,
  ): Promise<ProviderSettingsView>;
  /** 测试已经保存并进入目标 Environment Registry 的正式 Model。 */
  testModelConnectivity(
    input: ProviderSettingsConnectivityRequest,
  ): Promise<ModelConnectivityResult>;
  /**
   * 直接 HTTP 发现内置模板的可用模型列表（GET {baseUrl}/models，anthropic 走游标翻页）。
   * P1 吸收 A2 的“测试 Key”探测：不创建 provider、不启动 agent，失败仅作提示不阻塞保存。
   */
  discoverTemplateModels(input: DiscoverTemplateModelsInput): Promise<DiscoverTemplateModelsResult>;
  /**
   * 直接端点发现（P1.1 spec §3）：自定义 provider 保存路径按用户输入的 apiType +
   * baseUrl 直连模型列表端点；同样不创建 provider、不启动 agent，失败静默降级不阻塞保存。
   */
  discoverCustomProviderModels(
    input: DiscoverModelsForEndpointInput,
  ): Promise<DiscoverTemplateModelsResult>;
  /**
   * 从 provider 自身配置发起模型发现（P1.1 spec §4，设置页“发现模型”）。
   * apiType/baseUrl/apiKey 全部在服务端从配置视图解析；无 access（如 ollama 个人
   * provider）按无 Key 匿名发现。方法只收 providerId、只回模型 id/hints。
   */
  discoverProviderModels(providerId: ProviderId): Promise<DiscoverTemplateModelsResult>;
  /**
   * 批量合并发现到的模型（P1.1 spec §4）：单次 Personal 事务写入，与 personal 现有
   * id、builtin 继承 id 重复的条目静默跳过，返回实际新增数量；绝不删除或改写现有模型。
   */
  addPersonalModels(
    providerId: ProviderId,
    models: ReadonlyArray<InitialModelEntry>,
  ): Promise<number>;
}

export const IProviderSettingsService = createServiceDescriptor<IProviderSettingsService>(
  ServiceChannels.ProviderSettings,
);

export interface ProviderSettingsConnectivityTestInput {
  readonly workspacePath: string;
  readonly workspaceIdentity?: string;
  readonly providerId: ProviderId;
  readonly modelId: ModelId;
}

export interface ProviderSettingsConnectivityRequest {
  readonly workspacePath: string;
  readonly workspaceIdentity?: string;
  readonly providerId: ProviderId;
  readonly modelId: ModelId;
}

export type ProviderSettingsConnectivityTester = (
  input: ProviderSettingsConnectivityTestInput,
) => Promise<ModelConnectivityResult>;

export interface IModelSelectionService {
  readonly onDidChange: Event<ModelSelectionView>;
  getView(input?: ModelSelectionViewInput): Promise<ModelSelectionView>;
}

export interface ModelSelectionConfiguredDefaultSource {
  read(): Promise<ModelSelection | undefined>;
  onDidChange?(listener: () => void): () => void;
}

export const IModelSelectionService = createServiceDescriptor<IModelSelectionService>(
  ServiceChannels.ModelSelection,
);

export function createProviderSettingsService(
  facade: ProviderSettingsFacade,
  ensureReady: () => Promise<void> = async () => {},
  testConnectivity?: ProviderSettingsConnectivityTester,
  discoveryFetch?: DiscoverTemplateModelsFetch,
): IProviderSettingsService {
  return {
    onDidChange: toEvent((listener) => facade.onDidChange(listener)),
    getView: async () => {
      await ensureReady();
      return facade.getView();
    },
    refresh: async (reason) => {
      await ensureReady();
      return facade.refresh(reason);
    },
    createPersonalProvider: async (input) => {
      await ensureReady();
      return facade.createPersonalProvider(input);
    },
    resolveModelConfig: async (input) => {
      await ensureReady();
      return facade.resolveModelConfig(input);
    },
    savePersonalProviderOverlay: async (providerId, config, metadata) => {
      await ensureReady();
      return facade.savePersonalProviderOverlay(providerId, config, metadata);
    },
    deletePersonalProvider: async (providerId) => {
      await ensureReady();
      return facade.deletePersonalProvider(providerId);
    },
    reorderPersonalProviders: async (providerIds) => {
      await ensureReady();
      return facade.reorderPersonalProviders(providerIds);
    },
    reorderPersonalModels: async (providerId, modelIds) => {
      await ensureReady();
      return facade.reorderPersonalModels(providerId, modelIds);
    },
    addPersonalModel: async (providerId, modelId, config, useRecommendedConfig) => {
      await ensureReady();
      return facade.addPersonalModel(providerId, modelId, config, useRecommendedConfig);
    },
    renamePersonalModel: async (providerId, currentModelId, nextModelId) => {
      await ensureReady();
      return facade.renamePersonalModel(providerId, currentModelId, nextModelId);
    },
    deletePersonalModel: async (providerId, modelId) => {
      await ensureReady();
      return facade.deletePersonalModel(providerId, modelId);
    },
    savePersonalModelDraft: async (input) => {
      await ensureReady();
      return facade.savePersonalModelDraft(input);
    },
    setPersonalModelEnabled: async (providerId, modelId, enabled) => {
      await ensureReady();
      return facade.setPersonalModelEnabled(providerId, modelId, enabled);
    },
    testModelConnectivity: async (input) => {
      await ensureReady();
      if (!testConnectivity) {
        throw new Error("当前 Environment 未装配模型连通性测试能力");
      }
      await facade.waitForProviderOperations(input.providerId);
      // 禁用对象仍存在于配置视图，但不进入执行 Registry；不能把未发布误报成配置丢失。
      // 只消费操作完成后的公共资格，不另查 Key、权益，也不替代目标 Environment 最终校验。
      const provider = facade
        .getView()
        .providers.find((item) => item.providerId === input.providerId);
      const model = provider?.models.find((item) => item.modelId === input.modelId);
      const unavailable =
        !provider || !provider.enabled
          ? "provider-unavailable"
          : !model || !model.enabled || model.issues.length > 0
            ? "model-unavailable"
            : !provider.executable
              ? "provider-unavailable"
              : !model.executable
                ? "model-unavailable"
                : undefined;
      if (unavailable) {
        return {
          success: false,
          error: {
            code: unavailable,
            message:
              unavailable === "provider-unavailable"
                ? "This provider is currently unavailable for connectivity testing."
                : "This model is currently unavailable for connectivity testing.",
          },
        };
      }
      return testConnectivity({
        workspacePath: input.workspacePath,
        ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
        providerId: input.providerId,
        modelId: input.modelId,
      });
    },
    discoverTemplateModels: async (input) => {
      await ensureReady();
      if (!discoveryFetch) {
        // 发现是向导的提示性能力，未装配 fetch（如测试环境）时明确失败而不是抛错，
        // 让 UI 保持“可保存、发现不可用”的降级语义。
        return { ok: false, error: "template model discovery is not available" };
      }
      const view = facade.getView();
      const template = view.providerTemplates.find(
        (candidate) => candidate.templateId === input.templateId,
      );
      return discoverTemplateModels(input, { fetch: discoveryFetch, template });
    },
    discoverCustomProviderModels: async (input) => {
      await ensureReady();
      if (!discoveryFetch) {
        return { ok: false, error: "template model discovery is not available" };
      }
      return discoverModelsForEndpoint(input, { fetch: discoveryFetch });
    },
    discoverProviderModels: async (providerId) => {
      await ensureReady();
      if (!discoveryFetch) {
        return { ok: false, error: "template model discovery is not available" };
      }
      const provider = facade.getView().providers.find((item) => item.providerId === providerId);
      if (!provider) {
        return { ok: false, error: "provider not found" };
      }
      const api = provider.effectiveConfig.api;
      if (!api?.baseUrl) {
        return { ok: false, error: "provider has no base url" };
      }
      const access = provider.effectiveConfig.access;
      if (access != null && !isApiKeyAccess(access)) {
        return { ok: false, error: "unsupported provider access" };
      }
      // 密钥只在服务端（Host/RPC 服务端）解析并直连端点使用：本方法入参仅 providerId、
      // 出参仅模型 id/hints，Key 绝不跨 RPC 去 Renderer；错误文案只含 "provider not
      // found"、HTTP 状态等固定片段，杜绝把 Key 回显进 error（P1.1 spec §4）。
      const apiKey = isApiKeyAccess(access) ? access.apiKey?.trim() : undefined;
      return discoverModelsForEndpoint(
        {
          apiType: api.type ?? "openai-chat-completions",
          baseUrl: api.baseUrl,
          ...(apiKey ? { apiKey } : {}),
        },
        { fetch: discoveryFetch },
      );
    },
    addPersonalModels: async (providerId, models) => {
      await ensureReady();
      return facade.addPersonalModels(providerId, models);
    },
  };
}

export function createModelSelectionService(
  facade: ModelSelectionFacade,
  ensureReady: () => Promise<void> = async () => {},
  configuredDefaultSource?: ModelSelectionConfiguredDefaultSource,
): IModelSelectionService & { dispose(): void } {
  const log = createServiceLogger("model-selection");
  let revision = 0;
  let disposed = false;
  const listeners = new Set<(view: ModelSelectionView) => void>();
  const getView = async (input?: ModelSelectionViewInput): Promise<ModelSelectionView> => {
    await ensureReady();
    if (disposed) throw new Error("ModelSelectionService 已 dispose");
    const configuredDefault = await configuredDefaultSource?.read();
    if (disposed) throw new Error("ModelSelectionService 已 dispose");
    const base = facade.getView(configuredDefault);
    if (revision < base.revision) revision = base.revision;
    return facade.getView(configuredDefault, revision, input);
  };
  const emit = (): void => {
    if (disposed) return;
    revision += 1;
    void getView().then(
      (view) => {
        if (disposed) return;
        for (const listener of listeners) listener(view);
      },
      (error: unknown) => {
        // Registry 事件触发的异步 View 重建没有 owner；Host dispose 后它仍会继续
        // 读取已释放的配置仓库，并形成未处理 rejection。dispose 是明确的取消边界；仅在服务
        // 仍存活时记录真实读取失败。
        if (disposed) return;
        log.warn(undefined, `ModelSelection View 刷新失败: ${String(error)}`);
      },
    );
  };
  const disposeFacade = facade.onDidChange(emit);
  const disposeConfiguredDefault = configuredDefaultSource?.onDidChange?.(emit);

  return {
    onDidChange: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    getView,
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeFacade();
      disposeConfiguredDefault?.();
      listeners.clear();
    },
  };
}

function toEvent<T>(subscribe: (listener: (event: T) => void) => () => void): Event<T> {
  return (listener) => {
    const dispose = subscribe(listener);
    return { dispose };
  };
}
