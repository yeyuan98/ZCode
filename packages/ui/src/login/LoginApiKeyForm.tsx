import { useState } from "react";
import { isApiKeyAccess } from "@zcode/provider";
import { CheckCircle2Icon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import {
  TID_LOGIN_API_KEY_CANCEL_BUTTON,
  TID_LOGIN_API_KEY_CONTINUE_BUTTON,
  TID_LOGIN_API_KEY_ERROR,
  TID_LOGIN_API_KEY_INPUT,
  TID_LOGIN_API_KEY_SKIP_BUTTON,
} from "@zcode/shared";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useProbeTemplateApiKey } from "@/hooks/useProbeTemplateApiKey.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import {
  buildWizardSkipSettings,
  shouldShowLoginApiKeyLink,
} from "@/login/LoginApiKeyForm.helpers.js";

interface LoginApiKeyFormProps {
  templateId: string;
  /** 返回模板选择步骤。 */
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  onSkipped: () => void | Promise<void>;
}

export function LoginApiKeyForm({
  templateId,
  onCancel,
  onSaved,
  onSkipped,
}: LoginApiKeyFormProps) {
  const { intl, locale } = useZCodeIntl();
  const platform = usePlatform();
  const { providerSettingsService, settingService } = useServices();
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [skipArmed, setSkipArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { state: probeState, probe, reset: resetProbe } = useProbeTemplateApiKey();
  const providerSettingsRead = useProviderSettingsView();
  const providerSettingsView =
    providerSettingsRead.state.status === "ready" ? providerSettingsRead.state.view : null;

  const template = providerSettingsView?.providerTemplates.find(
    (candidate) => candidate.templateId === templateId,
  );
  const templateAccess = template?.config.access;
  const apiKeyUrl = isApiKeyAccess(templateAccess) ? templateAccess.apiKeyManagementUrl : undefined;
  // 用户已经输入或回填 API Key 后，右侧获取入口会挤占密码输入区域。
  const showApiKeyLink = shouldShowLoginApiKeyLink(apiKeyValue, apiKeyUrl ?? undefined);

  const saveApiKeyProvider = async () => {
    const apiKey = apiKeyValue.trim();
    if (!apiKey) {
      setError(intl.formatMessage({ id: "login.apiKey.emptyError" }));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const resolvedTemplate = (await providerSettingsService.getView()).providerTemplates.find(
        (item) => item.templateId === templateId,
      );
      if (!resolvedTemplate || !isApiKeyAccess(resolvedTemplate.config.access)) {
        setError(intl.formatMessage({ id: "login.apiKey.providerMissingError" }, { templateId }));
        return;
      }

      await providerSettingsService.createPersonalProvider({
        templateId,
        locale,
        initialConfig: { access: { type: resolvedTemplate.config.access.type, apiKey } },
      });
      await onSaved();
    } catch (saveError) {
      logger.error("[Wizard] 保存 API Key provider 失败", {
        templateId,
        error: saveError,
      });
      setError(
        intl.formatMessage(
          { id: "login.apiKey.saveError" },
          {
            error: saveError instanceof Error ? saveError.message : String(saveError),
          },
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const skipApiKeyProvider = async () => {
    setSkipping(true);
    setError(null);
    try {
      // 跳过只写入 providerOnboardingDismissedAt（启动门禁据此不再自动弹向导），
      // 不能写入空 API Key 或触发 API Key 登录成功事件，否则后续模型选择会误以为已有可用凭据。
      await settingService.update(buildWizardSkipSettings(new Date()));
      await onSkipped();
    } catch (skipError) {
      logger.error("[Wizard] 跳过首次配置失败", {
        error: skipError,
      });
      setError(
        intl.formatMessage(
          { id: "login.apiKey.skipError" },
          {
            error: skipError instanceof Error ? skipError.message : String(skipError),
          },
        ),
      );
    } finally {
      setSkipping(false);
    }
  };

  const testApiKey = async () => {
    const apiKey = apiKeyValue.trim();
    if (!apiKey) {
      setError(intl.formatMessage({ id: "login.apiKey.emptyError" }));
      return;
    }
    setError(null);
    // 探测失败只是提示（Key 可能仍然可用），不阻塞保存。
    await probe(templateId, apiKey);
  };

  const busy = saving || skipping;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "login.apiKey.title" })}
        </h2>
        <div className="space-y-2">
          <div className="relative">
            <Input
              id="login-api-key"
              type="password"
              size="lg"
              className={`h-10 w-full text-ui-base ${showApiKeyLink ? "pr-28" : ""}`}
              data-testid={TID_LOGIN_API_KEY_INPUT}
              aria-label={intl.formatMessage({
                id: "login.apiKey.placeholder",
              })}
              value={apiKeyValue}
              placeholder={intl.formatMessage({
                id: "login.apiKey.placeholder",
              })}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => {
                setApiKeyValue(event.target.value);
                setError(null);
                if (probeState.status !== "idle") {
                  resetProbe();
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && apiKeyValue.trim() && !busy) {
                  void saveApiKeyProvider();
                }
              }}
            />
            {showApiKeyLink ? (
              <button
                type="button"
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ui-base font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                disabled={busy}
                onClick={() => {
                  if (apiKeyUrl) {
                    platform.openExternal(apiKeyUrl);
                  }
                }}
              >
                {intl.formatMessage({ id: "login.apiKey.getApiKey" })}
              </button>
            ) : null}
          </div>
          {probeState.status !== "idle" ? (
            <div
              role="status"
              className="flex items-center gap-2 text-ui-base text-foreground-subtle"
            >
              {probeState.status === "testing" ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                  {intl.formatMessage({ id: "login.wizard.testKeyTesting" })}
                </>
              ) : probeState.status === "success" ? (
                <>
                  <CheckCircle2Icon className="size-4 text-success" aria-hidden="true" />
                  {intl.formatMessage(
                    { id: "login.wizard.testKeySuccess" },
                    { count: probeState.modelCount },
                  )}
                </>
              ) : (
                <>
                  <TriangleAlertIcon className="size-4" aria-hidden="true" />
                  {intl.formatMessage(
                    { id: "login.wizard.testKeyFail" },
                    { error: probeState.error },
                  )}
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <Alert variant="destructive" data-testid={TID_LOGIN_API_KEY_ERROR}>
          <TriangleAlertIcon className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Button
          type="button"
          className="h-10 w-full text-ui-base"
          size="lg"
          data-testid={TID_LOGIN_API_KEY_CONTINUE_BUTTON}
          disabled={!apiKeyValue.trim() || busy}
          onClick={() => void saveApiKeyProvider()}
        >
          {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
          {intl.formatMessage({ id: "login.apiKey.continue" })}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full text-ui-base"
          size="lg"
          disabled={!apiKeyValue.trim() || busy || probeState.status === "testing"}
          onClick={() => void testApiKey()}
        >
          {probeState.status === "testing" ? <Loader2Icon className="size-4 animate-spin" /> : null}
          {intl.formatMessage({ id: "login.wizard.testKey" })}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full text-ui-base"
          size="lg"
          data-testid={TID_LOGIN_API_KEY_CANCEL_BUTTON}
          disabled={busy}
          onClick={onCancel}
        >
          {intl.formatMessage({ id: "login.apiKey.cancel" })}
        </Button>
        <Button
          type="button"
          variant="link"
          className="h-7 w-full text-ui-base text-foreground-subtle hover:text-foreground"
          data-testid={TID_LOGIN_API_KEY_SKIP_BUTTON}
          disabled={busy}
          onClick={() => {
            // 跳过会持久化 providerOnboardingDismissedAt，向导不再自动弹出；二次点击确认避免误触。
            if (!skipArmed) {
              setSkipArmed(true);
              return;
            }
            void skipApiKeyProvider();
          }}
        >
          {skipping ? <Loader2Icon className="size-4 animate-spin" /> : null}
          {intl.formatMessage({
            id: skipArmed ? "login.wizard.skipConfirm" : "login.skip",
          })}
        </Button>
      </div>
    </div>
  );
}
