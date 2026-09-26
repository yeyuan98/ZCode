import { type AppSettings } from "@zcode/shared";

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
