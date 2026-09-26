/**
 * 自托管 Web token 登录门禁 E2E（specs/onboarding-and-gate.md 第 4 条）：
 * 服务器启用 authToken 时首屏进入登录页；错误 token 显示错误，
 * 正确 token 写入 zcode_lite_token Cookie 并无回环地进入应用外壳。
 */
import { expect } from "@playwright/test";
import { test, E2E_SERVER_TOKEN } from "./fixtures.js";

const TOKEN_INPUT = "#zcode-server-token";
const SUBMIT_BUTTON = "Sign in";
/** Web 工作区外壳（WorkspaceShellLayout 固定 data 属性）。 */
const APP_SHELL = `[data-workspace-shell="true"]`;

test.describe("web token login", () => {
  test("login page is shown when the server enforces auth", async ({ page, tokenApp }) => {
    await page.goto(tokenApp.origin);
    await expect(page.locator(TOKEN_INPUT)).toBeVisible();
    // 门禁只拦截 /ws 与 /api/*；静态首页本身可达，未登录时不应进入应用外壳。
    await expect(page.locator(APP_SHELL)).toHaveCount(0);
  });

  test("wrong token shows an error and stays on the login page", async ({ page, tokenApp }) => {
    await page.goto(tokenApp.origin);
    await page.locator(TOKEN_INPUT).fill("definitely-wrong-token");
    await page.getByRole("button", { name: SUBMIT_BUTTON }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator(TOKEN_INPUT)).toBeVisible();
  });

  test("correct token sets the cookie and boots the app shell without a loop", async ({
    page,
    tokenApp,
  }) => {
    await page.goto(tokenApp.origin);
    await page.locator(TOKEN_INPUT).fill(E2E_SERVER_TOKEN);
    await page.getByRole("button", { name: SUBMIT_BUTTON }).click();

    // 登录成功：服务端下发 HttpOnly Cookie，前端原地重跑启动流程进入工作区。
    await expect(page.locator(APP_SHELL)).toBeVisible();
    await expect(page.locator(TOKEN_INPUT)).toHaveCount(0);

    const cookies = await page.context().cookies(tokenApp.origin);
    const liteToken = cookies.find((cookie) => cookie.name === "zcode_lite_token");
    expect(liteToken?.value).toBe(E2E_SERVER_TOKEN);

    // 无回环：仍停留在根路径，没有被重定向到登录入口。
    expect(page.url()).toBe(`${tokenApp.origin}/`);
  });
});
