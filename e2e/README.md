# Web E2E (Playwright)

针对真实 Web 应用（`packages/web` 构建产物 + `packages/server` HTTP 服务）的 Playwright 端到端测试。

## 前置条件

- Node（本仓库在 Node v22 宿主上验证通过）与 pnpm workspace 已 `pnpm install`。
- 已安装 Playwright Chromium：`pnpm exec playwright install chromium`。
  离线环境可用系统 Chromium：在 `playwright.config.ts` 的 chromium project 上设置
  `executablePath`（或 `channel`）指向 `/usr/bin/chromium` 等系统浏览器。
- 已构建 Web 产物：`pnpm --dir packages/web build`（输出 `packages/web/dist`，已被根 `dist/` 忽略规则覆盖）。

## 运行

```bash
pnpm --dir packages/web build   # 首次或 UI 变更后
pnpm test:e2e                   # 等价于 playwright test
```

## 覆盖范围

- `wizard.spec.ts` — 首次启动门禁与欢迎向导（`specs/onboarding-and-gate.md`）：
  - 全新状态自动弹出向导（模板选择页）；
  - 自定义 provider（名称 + Base URL + API Key）保存后向导关闭并进入应用外壳；
  - 模板 “测试 API Key” 探测成功态（含模型数量）与错误 key 的 401 失败态；
  - 跳过向导后 `providerOnboardingDismissedAt` 由服务端 settings 持久化，刷新不再弹出。
- `token-login.spec.ts` — 自托管 token 登录门禁：
  - 启用 `authToken` 的服务器首屏进入登录页；
  - 错误 token 显示错误并停留在登录页；
  - 正确 token 写入 `zcode_lite_token` Cookie，无回环进入应用外壳。

## 夹具架构

- `fixtures.ts` 起两类服务：
  - **mock provider**：worker 级共享的 node http 服务，实现 OpenAI 兼容
    `GET /v1/models`（`Authorization: Bearer e2e-key` 通过，其余 401）；
  - **真实应用服务器**：test 级，用 `tsx` 子进程运行 `serverBootstrap.ts`，
    装配镜像 `packages/server/src/entry-http.ts`（`materializeZCodeBuiltinProviderConfig`
    → `createLocalServices` → `createHttpServer`，静态根指向 `packages/web/dist`）。
- 数据隔离：每个服务器实例拥有独立临时目录，同时作为 `HOME` 与
  `ZCODE_DATA_BASE_DIR`（setting.json 在 `$HOME/.zcode`，其余数据在 dataBaseDir/.zcode），
  测试之间 provider / settings 状态互不泄漏；`ZCODE_ENDPOINT_ORIGIN` 指向 mock 服务，
  阻断内置 provider 配置的远端 CDN 刷新。
- mock 模板：夹具克隆仓库 `config/provider/zcode-builtin.json` 中的 api-key + openai
  兼容模板，注入 `mock-e2e` 模板（baseUrl 指向 mock provider），保证探测/保存流程
  全程不访问真实厂商端点。
- 产物目录：`e2e/.playwright/`（临时 home/工作区，测试后自动清理）、
  `playwright-report/`、`test-results/` 均已加入 `.gitignore`。

## CI 备注

GitHub Actions ubuntu runner 自带 Playwright 支持：安装依赖后执行
`pnpm exec playwright install chromium --with-deps` 即可用同一条 `pnpm test:e2e` 运行。
