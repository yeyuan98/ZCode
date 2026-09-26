/**
 * 向导（WelcomeScreen / onboarding gate）E2E：
 * 覆盖 specs/onboarding-and-gate.md 的启动门禁、模板/自定义 provider 保存、
 * “测试 API Key” 探测（成功 + 401 失败）与跳过持久化。
 */
import { expect } from "@playwright/test";
import { test, E2E_API_KEY, MOCK_TEMPLATE_ID } from "./fixtures.js";

/** 内置目录里的自定义卡片（ProviderTemplatePicker 固定项）。 */
const CUSTOM_TEMPLATE_ITEM = `model-provider-template-item-custom`;
const MOCK_TEMPLATE_ITEM = `model-provider-template-item-${MOCK_TEMPLATE_ID}`;
/** 向导模板选择页（模板加载完成后出现，作为“向导可见”的稳定锚点）。 */
const TEMPLATE_PICKER = `model-provider-template-picker`;
/** API Key 输入框（模板与自定义表单共用同一 testid）。 */
const API_KEY_INPUT = `login-api-key-input`;
const API_KEY_CONTINUE_BUTTON = `login-api-key-continue-button`;
const API_KEY_SKIP_BUTTON = `login-api-key-skip-button`;
/** Web 工作区外壳（WorkspaceShellLayout 固定 data 属性），作为“应用已进入主界面”的锚点。 */
const APP_SHELL = `[data-workspace-shell="true"]`;
/** 全新用户在向导关闭后会先看到职业首跑引导；退出引导即进入主界面（真实产品路径）。 */
const EXIT_ONBOARDING_BUTTON = "Exit onboarding";

/** 退出职业首跑引导并等待工作区外壳出现。 */
async function expectAppShell(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: EXIT_ONBOARDING_BUTTON }).click();
  await expect(page.locator(APP_SHELL)).toBeVisible();
}

test.describe("welcome wizard", () => {
  test("fresh state opens the wizard with the template picker", async ({ page, wizardApp }) => {
    await page.goto(wizardApp.origin);
    await expect(page.getByTestId(TEMPLATE_PICKER)).toBeVisible();
    await expect(page.getByTestId(CUSTOM_TEMPLATE_ITEM)).toBeVisible();
    await expect(page.getByTestId(MOCK_TEMPLATE_ITEM)).toBeVisible();
  });

  test("custom provider save closes the wizard into the app shell", async ({
    page,
    wizardApp,
    mockProvider,
  }) => {
    await page.goto(wizardApp.origin);
    await page.getByTestId(CUSTOM_TEMPLATE_ITEM).click();

    // 自定义表单：名称 / Base URL（指向 mock provider）/ API Key。
    await page.locator("#login-custom-provider-name").fill("Mock Custom");
    await page.locator("#login-custom-provider-base-url").fill(`${mockProvider.origin}/v1`);
    await page.getByTestId(API_KEY_INPUT).fill(E2E_API_KEY);
    // 表单没有单独的探测按钮（探测仅在模板路径提供），保存即创建 personal provider。
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByTestId(TEMPLATE_PICKER)).toBeHidden();
    await expectAppShell(page);
  });

  test("template api key probe succeeds then save closes the wizard", async ({
    page,
    wizardApp,
  }) => {
    await page.goto(wizardApp.origin);
    await page.getByTestId(MOCK_TEMPLATE_ITEM).click();

    await page.getByTestId(API_KEY_INPUT).fill(E2E_API_KEY);
    await page.getByRole("button", { name: "Test API key" }).click();
    // 探测成功态：role=status 且包含成功文案与模型数量。
    await expect(page.getByRole("status")).toContainText("API key works");
    await expect(page.getByRole("status")).toContainText("1");

    await page.getByTestId(API_KEY_CONTINUE_BUTTON).click();
    await expect(page.getByTestId(TEMPLATE_PICKER)).toBeHidden();
    await expectAppShell(page);
  });

  test("template api key probe shows failure state on wrong key", async ({ page, wizardApp }) => {
    await page.goto(wizardApp.origin);
    await page.getByTestId(MOCK_TEMPLATE_ITEM).click();

    await page.getByTestId(API_KEY_INPUT).fill("wrong-key");
    await page.getByRole("button", { name: "Test API key" }).click();
    // mock provider 返回 401，探测失败态带 HTTP 状态；文案同时说明仍可保存。
    await expect(page.getByRole("status")).toContainText("Test failed");
    await expect(page.getByRole("status")).toContainText("401");
  });

  test("skip persists dismissal across reload", async ({ page, wizardApp }) => {
    await page.goto(wizardApp.origin);
    await page.getByTestId(MOCK_TEMPLATE_ITEM).click();

    // 跳过是二次确认按钮：第一次点击武装，第二次才写入 providerOnboardingDismissedAt。
    const skipButton = page.getByTestId(API_KEY_SKIP_BUTTON);
    await skipButton.click();
    await skipButton.click();

    await expect(page.getByTestId(TEMPLATE_PICKER)).toBeHidden();
    await expectAppShell(page);

    // 重新加载：跳过标记已由服务端 settings 持久化，向导不得再次弹出。
    await page.reload();
    await expect(page.locator(APP_SHELL)).toBeVisible();
    await expect(page.getByTestId(TEMPLATE_PICKER)).toHaveCount(0);
  });
});
