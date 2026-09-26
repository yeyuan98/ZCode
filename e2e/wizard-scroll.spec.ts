import { expect } from "@playwright/test";
import { test, MOCK_TEMPLATE_ID } from "./fixtures.js";

const MOCK_TEMPLATE_ITEM = `model-provider-template-item-${MOCK_TEMPLATE_ID}`;
const TEMPLATE_PICKER = `model-provider-template-picker`;

test.describe("wizard screenshots (manual inspection)", () => {
  test("template list scrolls to every provider with header staying pinned", async ({
    page,
    wizardApp,
  }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto(wizardApp.origin);
    await expect(page.getByTestId(TEMPLATE_PICKER)).toBeVisible();

    // 短视口下列表溢出：头部必须仍在视口内（不被裁掉），这是 alpha.2 裁切缺陷的回归断言。
    await expect(page.getByRole("heading", { name: "Welcome to ZCode" })).toBeInViewport();

    const items = page.locator('[data-testid^="model-provider-template-item-"]');
    // 全量模板（含注入的 mock）+ 自定义卡片都必须可滚动到达。
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(2);
    const last = items.nth(count - 1);
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();

    // 滚动到底后头部依旧固定可见。
    await expect(page.getByRole("heading", { name: "Welcome to ZCode" })).toBeInViewport();

    await page.getByTestId(MOCK_TEMPLATE_ITEM).scrollIntoViewIfNeeded();
    await page.getByTestId(MOCK_TEMPLATE_ITEM).click();
    await expect(page.getByRole("heading", { name: "Mock E2E" })).toBeVisible();
  });
});
