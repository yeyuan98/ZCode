import { type AppSettings } from "@zcode/shared";
import type {
  DiscoveryModelHints,
  IProviderSettingsService,
  ProviderSettingsView,
} from "@zcode/services";

/**
 * 向导“跳过”写入 settings 的内容：只记录跳过时间，让启动门禁不再自动弹出向导。
 * 不能写入空 API Key 或触发 API Key 登录成功事件，否则后续模型选择会误以为已有可用凭据。
 */
export function buildWizardSkipSettings(
  now: Date,
): Pick<AppSettings, "providerOnboardingDismissedAt"> {
  return { providerOnboardingDismissedAt: now.toISOString() };
}

export function shouldShowLoginApiKeyLink(
  apiKeyValue: string,
  apiKeyUrl: string | undefined,
): boolean {
  return Boolean(apiKeyUrl) && apiKeyValue.trim().length === 0;
}

/** 向导保存的 initialModels 条目：纯 id 或带端点能力 hints 的对象形态。 */
export type WizardInitialModel =
  | string
  | { readonly id: string; readonly hints: DiscoveryModelHints };

/**
 * 把发现结果（ids + 按 id 的可选 hints）折算成 createPersonalProvider 的 initialModels：
 * 有 hints 的模型用对象形态携带，纯 id 保持字符串形态；hints 由 provider 层在持久化时
 * 只填目录解析留空的字段（spec §2），UI 不做过滤。
 */
export function buildInitialModels(
  modelIds: readonly string[],
  modelHints?: Readonly<Record<string, DiscoveryModelHints>>,
): readonly WizardInitialModel[] {
  return modelIds.map((id) => {
    const hints = modelHints?.[id];
    // 空 hints 对象归一为纯 id（解析层只为有元数据字段的模型产生条目）。
    const hasHints = hints != null && Object.keys(hints).length > 0;
    return hasHints ? { id, hints } : id;
  });
}

/** 向导“测试并发现”hook 的状态子集（结构化收窄，避免 helpers 依赖 hook 模块）。 */
type WizardDiscoveryState =
  | { status: "idle" }
  | { status: "testing" }
  | {
      status: "success";
      modelIds: readonly string[];
      modelHints?: Readonly<Record<string, DiscoveryModelHints>>;
    }
  | { status: "failure"; error: string };

/**
 * 解析保存时要持久化的 initialModels（P1.1 spec §3）：
 * - 按钮发现成功（success）：沿用 hook 结果的 ids + hints；
 * - 从未发现（idle）且模板带 api 配置：在保存处理器里直接调用服务自动发现（静默、
 *   用本地结果；绝不经由 hook state，避免 stale closure），失败/空列表按空模型保存；
 * - 曾发现失败（failure）：不重跑（避免二次 15s 等待），按空模型保存。
 */
export async function resolveWizardInitialModels(
  providerSettingsService: IProviderSettingsService,
  input: {
    readonly templateId: string;
    readonly apiKey: string;
    readonly discoveryState: WizardDiscoveryState;
    readonly resolvedTemplate: ProviderSettingsView["providerTemplates"][number];
    readonly onAutoDiscoverError?: (error: unknown) => void;
  },
): Promise<readonly WizardInitialModel[]> {
  if (input.discoveryState.status === "success") {
    return buildInitialModels(input.discoveryState.modelIds, input.discoveryState.modelHints);
  }
  if (input.discoveryState.status !== "idle" || !input.resolvedTemplate.config.api?.baseUrl) {
    return [];
  }
  try {
    const result = await providerSettingsService.discoverTemplateModels({
      templateId: input.templateId,
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    });
    return result.ok ? buildInitialModels(result.modelIds, result.modelHints) : [];
  } catch (error) {
    // 自动发现是静默兜底：任何异常都不得阻塞保存（与“测试并发现”失败的降级语义一致）。
    input.onAutoDiscoverError?.(error);
    return [];
  }
}
