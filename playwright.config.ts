/**
 * Playwright 配置：仅测试 e2e/ 目录下的 Web 端 E2E。
 *
 * - 服务器由 e2e/fixtures.ts 里的 fixture（tsx 子进程）按测试拉起并隔离数据目录，
 *   因此这里不使用 playwright 的 webServer；
 * - workers=1 串行执行：每个测试自建服务器实例，串行让失败输出最易读；
 * - Chromium 优先使用 playwright 自带浏览器；离线环境可用 executablePath 指向系统 chromium。
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "./test-results",
  use: {
    headless: true,
    locale: "en-US",
    // 向导模板目录较长且外层不可滚动；加高视口保证全部模板卡片可点击。
    viewport: { width: 1280, height: 1800 },
    // 应用启动链路较重（服务装配 + WS + 模板加载），统一放宽导航超时。
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
      },
    },
  ],
});
