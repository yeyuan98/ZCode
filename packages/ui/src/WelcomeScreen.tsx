/**
 * WelcomeScreen —— 首次配置向导
 *
 * P2 起替代厂商 OAuth 登录页：模板选择（内置目录 + 自定义）→ 填 API Key（可选探测）→ 保存自动关闭。
 * OAuth 面板与对应 hook 已删除（厂商 OAuth 服务在 P3 删除）；向导在出现可用 provider 时自动关闭。
 *
 * 布局复用 OccupationOnboarding 的全屏向导范式：顶部 pt-12 让出拖拽区 + 窗口控件，
 * 卡片高度受限（max-h-full），头部固定、仅步骤主体在卡内滚动（min-h-0 flex-1 overflow-y-auto），
 * 短内容 my-auto 居中。卡片宽度随步骤切换（模板选择 max-w-2xl，表单步骤 max-w-sm），不做动画。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { resolveProviderTemplateName } from "@zcode/provider";
import { TID_LOGIN_API_KEY_ERROR, TID_LOGIN_API_KEY_INPUT } from "@zcode/shared";
import { Alert, AlertDescription } from "./components/ui/alert.js";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";
import { DesktopWindowControls } from "@/DesktopWindowControls.js";
import { ZCodeAboutLogo } from "@/components/ui/ZCodeAboutLogo.js";
import { useZCodeIntl } from "./i18n/IntlProvider.js";
import { LoginApiKeyForm } from "./login/LoginApiKeyForm.js";
import { buildWizardSkipSettings } from "@/login/LoginApiKeyForm.helpers.js";
import { useProviderSettingsView } from "./hooks/useProviderSettingsView.js";
import { useServices } from "./hooks/useServices.js";
import { logger } from "./logger.js";
import { ProviderLogo } from "./settings/model-provider-section/ProviderLogo.js";
import { ProviderTemplatePicker } from "./settings/model-provider-section/ProviderTemplatePicker.js";
import { ProviderDetailFeedbackBoundary } from "./settings/model-provider-section/ProviderDetailFeedback.js";
import { ThemeHeroVisual } from "./openWorkspacePageThemeHero.js";

interface WelcomeScreenProps {
  onComplete: (reason: LoginCompleteReason) => void | Promise<void>;
  /** 当前是否存在可用 provider；由 false 变为 true 时向导自动关闭。 */
  hasUsableProvider: boolean;
  /** Win/Linux 无边框窗口需要渲染最小化/最大化/关闭控件（与 OccupationOnboarding 同一判定）。 */
  showWindowControls?: boolean;
}

export type LoginCompleteReason = "apiKey" | "skip";

export function WelcomeScreen({
  onComplete,
  hasUsableProvider,
  showWindowControls = false,
}: WelcomeScreenProps) {
  return (
    <main className="relative flex h-dvh w-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <ThemeHeroVisual className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-12 [app-region:drag]" />
      {showWindowControls ? (
        <div className="absolute right-1 top-1 z-30 mt-px mr-px flex h-12 items-center px-2">
          <DesktopWindowControls />
        </div>
      ) : null}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col pt-12 [@media(max-height:740px)]:pt-10">
        {/* 卡片高度受限（max-h-full）：短内容 my-auto 垂直居中；长内容卡片封顶，
            仅步骤主体在卡内滚动，头部（品牌/供应商标题）始终固定可见。 */}
        <div className="flex min-h-0 flex-1 flex-col px-4 py-6 sm:px-6">
          <LoginPanel onComplete={onComplete} hasUsableProvider={hasUsableProvider} />
        </div>
      </div>
    </main>
  );
}

type WizardStep =
  | { kind: "template" }
  | { kind: "key"; templateId: string }
  | { kind: "custom"; label: string };

function LoginPanel({
  onComplete,
  hasUsableProvider,
}: {
  onComplete: (reason: LoginCompleteReason) => void | Promise<void>;
  hasUsableProvider: boolean;
}) {
  const { intl, locale } = useZCodeIntl();
  const [step, setStep] = useState<WizardStep>({ kind: "template" });
  const providerSettingsRead = useProviderSettingsView();
  const providerSettingsView =
    providerSettingsRead.state.status === "ready" ? providerSettingsRead.state.view : null;
  const templates = providerSettingsView?.providerTemplates ?? [];
  const autoCompleteClosedRef = useRef(false);
  const previousHasUsableProviderRef = useRef(hasUsableProvider);

  // 自动关闭不变量：向导打开期间一旦出现可用 provider（例如恢复中的 OAuth 会话填充了
  // provider，或用户完成保存）立即关闭。只响应 false→true 的变化：手动入口在已有可用
  // provider 时打开向导属于用户主动添加 provider，不能被立刻弹掉。
  useEffect(() => {
    const wasUsable = previousHasUsableProviderRef.current;
    previousHasUsableProviderRef.current = hasUsableProvider;
    if (!hasUsableProvider || wasUsable || autoCompleteClosedRef.current) {
      return;
    }
    autoCompleteClosedRef.current = true;
    void onComplete("apiKey");
  }, [hasUsableProvider, onComplete]);

  // 保存/跳过与自动关闭可能竞争（保存后 provider 可用性翻转先于 onSaved 触发），
  // 双方共用同一个一次性关闭闸，保证 onComplete 只触发一次。
  const handleApiKeySaved = useCallback(() => {
    autoCompleteClosedRef.current = true;
    onComplete("apiKey");
  }, [onComplete]);
  const handleSkipped = useCallback(() => {
    autoCompleteClosedRef.current = true;
    onComplete("skip");
  }, [onComplete]);

  // 步骤头部随步骤变化：模板步保留品牌欢迎文案；Key 步改为所选供应商的名称与
  // 图标（同一份 resolveProviderTemplateName 数据源，与卡片展示一致），
  // 不能在用户已选完供应商后还提示“选择模型供应商”。
  const keyStepTemplate =
    step.kind === "key"
      ? (templates.find((candidate) => candidate.templateId === step.templateId) ?? null)
      : null;
  let headerTitle: string;
  let headerDescription: string;
  let headerIcon: ReactNode = null;
  if (step.kind === "key") {
    // 模板快照瞬时为空时用空 nameMap 兜底：resolveProviderTemplateName 会退回 templateId 原文，
    // 也好过退回“选择供应商”的品牌文案（用户已经选完了）。
    const templateForName = keyStepTemplate ?? { templateNameMap: {} };
    headerTitle = resolveProviderTemplateName(step.templateId, templateForName, locale);
    const keyless = keyStepTemplate?.config.access == null;
    headerDescription = intl.formatMessage(
      { id: keyless ? "login.wizard.keylessStepDescription" : "login.wizard.keyStepDescription" },
      { provider: headerTitle },
    );
    headerIcon = keyStepTemplate ? (
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface">
        <ProviderLogo logo={keyStepTemplate.config.logo} className="size-7" />
      </span>
    ) : null;
  } else if (step.kind === "custom") {
    headerTitle = intl.formatMessage({ id: "login.wizard.custom.title" });
    headerDescription = intl.formatMessage({ id: "login.wizard.custom.hint" });
  } else {
    headerTitle = intl.formatMessage({ id: "login.title" });
    headerDescription = intl.formatMessage({ id: "login.description" });
  }

  return (
    <section
      className={`mx-auto my-auto flex max-h-full w-full flex-col gap-8 rounded-2xl border border-popover-border bg-background p-8 text-ui-base/relaxed shadow-md sm:p-10 ${
        step.kind === "template" ? "max-w-2xl" : "max-w-sm"
      }`}
    >
      <LoginPanelHeader title={headerTitle} description={headerDescription} icon={headerIcon} />

      {/* 步骤主体在卡片内滚动：列表再长也只裁在这一区域，头部与卡片圆角始终完整。 */}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto [scrollbar-gutter:stable]">
        {step.kind === "template" ? (
          providerSettingsRead.state.status === "loading" ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-6 text-ui-base text-foreground-subtle">
              <Loader2Icon className="size-4 animate-spin" />
              {intl.formatMessage({ id: "login.wizard.loadingTemplates" })}
            </div>
          ) : templates.length === 0 ? (
            <Alert variant="warning" className="flex items-center justify-center gap-2 text-center">
              <TriangleAlertIcon className="size-4" />
              <AlertDescription className="text-center">
                {intl.formatMessage({ id: "login.wizard.noTemplates" })}
              </AlertDescription>
            </Alert>
          ) : (
            <ProviderDetailFeedbackBoundary>
              {/* 设置页用同一份 ProviderTemplatePicker；失败横幅复用详情反馈边界，向导内自包含展示。
                  向导场景隐藏其设置页标题（showHeader=false），由向导头部统一承载步骤标题。 */}
              <ProviderTemplatePicker
                templates={templates}
                creating={false}
                showHeader={false}
                onCreateFromTemplate={async (templateId) => setStep({ kind: "key", templateId })}
                onCreateCustom={async (label) => setStep({ kind: "custom", label })}
              />
            </ProviderDetailFeedbackBoundary>
          )
        ) : null}

        {step.kind === "key" ? (
          <LoginApiKeyForm
            templateId={step.templateId}
            onCancel={() => setStep({ kind: "template" })}
            onSaved={handleApiKeySaved}
            onSkipped={handleSkipped}
          />
        ) : null}

        {step.kind === "custom" ? (
          <CustomProviderForm
            initialName={step.label}
            onCancel={() => setStep({ kind: "template" })}
            onSaved={handleApiKeySaved}
            onSkipped={handleSkipped}
          />
        ) : null}
      </div>
    </section>
  );
}

function CustomProviderForm({
  initialName,
  onCancel,
  onSaved,
  onSkipped,
}: {
  initialName: string;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  onSkipped: () => void | Promise<void>;
}) {
  const { intl, locale } = useZCodeIntl();
  const { providerSettingsService, settingService } = useServices();
  const [nameValue, setNameValue] = useState(initialName);
  const [baseUrlValue, setBaseUrlValue] = useState("");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [skipArmed, setSkipArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveCustomProvider = async () => {
    const apiKey = apiKeyValue.trim();
    const baseUrl = baseUrlValue.trim().replace(/\/+$/, "");
    if (!apiKey || !baseUrl) {
      setError(intl.formatMessage({ id: "login.wizard.custom.requiredError" }));
      return;
    }
    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch {
      setError(intl.formatMessage({ id: "login.wizard.custom.baseUrlInvalidError" }));
      return;
    }
    if (parsedBaseUrl.protocol !== "http:" && parsedBaseUrl.protocol !== "https:") {
      setError(intl.formatMessage({ id: "login.wizard.custom.baseUrlInvalidError" }));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // 自定义供应商按 OpenAI 兼容端点创建（镜像设置页 createPersonalProvider 的
      // initialConfig 覆盖：api.baseUrl + api-key access），本地模型（Ollama/vLLM）走同一路径。
      // locale 与设置页保持一致：zh-CN 用户拿到本地化的默认模板文案。
      await providerSettingsService.createPersonalProvider({
        ...(nameValue.trim() ? { providerName: nameValue.trim() } : {}),
        locale,
        initialConfig: {
          access: { type: "api-key", apiKey },
          api: { type: "openai-chat-completions", baseUrl: parsedBaseUrl.toString() },
        },
      });
      await onSaved();
    } catch (saveError) {
      logger.error("[Wizard] 保存自定义 provider 失败", {
        baseUrl,
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

  const skipCustomProvider = async () => {
    setSkipping(true);
    setError(null);
    try {
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

  const busy = saving || skipping;

  return (
    <div className="space-y-4">
      {/* 步骤标题由向导头部统一承载（自定义供应商 + OpenAI 兼容提示），表单内不再重复小标题。 */}
      <div className="space-y-2">
        <Input
          id="login-custom-provider-name"
          type="text"
          size="lg"
          autoFocus
          className="h-10 w-full text-ui-base"
          aria-label={intl.formatMessage({ id: "login.wizard.custom.name" })}
          value={nameValue}
          placeholder={intl.formatMessage({ id: "login.wizard.custom.name" })}
          autoComplete="off"
          disabled={busy}
          onChange={(event) => {
            setNameValue(event.target.value);
            setError(null);
          }}
        />
        <Input
          id="login-custom-provider-base-url"
          type="text"
          size="lg"
          className="h-10 w-full text-ui-base"
          aria-label={intl.formatMessage({ id: "login.wizard.custom.baseUrl" })}
          value={baseUrlValue}
          placeholder="https://example.com/v1"
          autoComplete="off"
          disabled={busy}
          onChange={(event) => {
            setBaseUrlValue(event.target.value);
            setError(null);
          }}
        />
        <Input
          id="login-custom-provider-api-key"
          type="password"
          size="lg"
          className="h-10 w-full text-ui-base"
          data-testid={TID_LOGIN_API_KEY_INPUT}
          aria-label={intl.formatMessage({ id: "login.wizard.custom.apiKey" })}
          value={apiKeyValue}
          placeholder={intl.formatMessage({ id: "login.apiKey.placeholder" })}
          autoComplete="off"
          disabled={busy}
          onChange={(event) => {
            setApiKeyValue(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && apiKeyValue.trim() && baseUrlValue.trim() && !busy) {
              void saveCustomProvider();
            }
          }}
        />
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
          disabled={!apiKeyValue.trim() || !baseUrlValue.trim() || busy}
          onClick={() => void saveCustomProvider()}
        >
          {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
          {intl.formatMessage({ id: "login.apiKey.continue" })}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full text-ui-base"
          size="lg"
          disabled={busy}
          onClick={onCancel}
        >
          {intl.formatMessage({ id: "login.apiKey.cancel" })}
        </Button>
        <Button
          type="button"
          variant="link"
          className="h-7 w-full text-ui-base text-foreground-subtle hover:text-foreground"
          disabled={busy}
          onClick={() => {
            // 跳过会持久化 providerOnboardingDismissedAt，向导不再自动弹出；二次点击确认避免误触。
            if (!skipArmed) {
              setSkipArmed(true);
              return;
            }
            void skipCustomProvider();
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

function LoginPanelHeader({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  /** Key 步展示所选供应商图标（与卡片同源）；其余步骤为空，仅保留品牌 logo。 */
  icon?: ReactNode;
}) {
  return (
    <header className="flex flex-col items-center gap-3 text-center">
      <LoginPanelLogo />
      <div className="flex flex-col items-center gap-1 text-center">
        <div className="flex min-w-0 items-center justify-center gap-2">
          {icon}
          <h1 className="min-w-0 break-words text-3xl font-semibold tracking-tight">{title}</h1>
        </div>
        <p className="text-ui-base/relaxed text-foreground-subtle">{description}</p>
      </div>
    </header>
  );
}

function LoginPanelLogo() {
  return (
    // 登录 logo 壳是固定深色底，边框不能跟随浅色主题 token，否则浅色主题下边框过重。
    <div
      className="relative mb-1 flex size-16 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#000000_0%,#151718_100%)] text-[#ffffff] shadow-lg/20 before:pointer-events-none before:absolute before:inset-0 before:rounded-2xl before:border before:border-[rgba(255,255,255,0.1)]"
      aria-label="ZCode"
      role="img"
    >
      <ZCodeAboutLogo className="h-auto w-10" />
    </div>
  );
}
