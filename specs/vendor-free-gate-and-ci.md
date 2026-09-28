# Vendor-Free Gate 与 PR CI（P6 设计记录）

状态：P6 设计基准（2026-09-28 定稿，含四条用户指令约束）。

## 目标

- 永久回归门禁：阻止厂商标识回流代码库（五模式，见下）。
- 首个 PR CI workflow：把既有质量门禁全部自动化（此前全部手工执行）。

## 用户指令（P6 约束，2026-09-28，绑定）

1. 门禁只用五个"确凿"模式；**不匹配 `glm`** —— GLM 是受支持的普通模型族（目录含
   glm-5.3 等规则），provider 图标组件名也合法含 "Glm"；匹配它会迫使复杂 allowlist，
   零安全收益。
2. "以防万一"的遗留结构一律删除（alpha 阶段清洁性/可维护性优先于兼容）；例外
   `desktopDeviceMid.ts` 仅修正过期注释，是否删除由用户另行评估。
3. 文档不做搜索（SearXNG 等）指引 —— 搜索可由标准 MCP 满足，无需特殊文档；根
   README 精简为最短上手路径并指向 `docs/` 模块文档；模块文档从简入繁、以详细
   API/编程参考收尾。
4. 最终正式版 3.14.3 不在本阶段范围（另会处理；该会话继承 alpha.10→3.14.3 的
   in-app 更新验证与 runbook 末步）。

## 门禁设计（`scripts/check-vendor-free.mjs`，净新增）

- 模式（大小写不敏感，防奇形大小写域名漏网；均为域名/账号标识，只可能指厂商）：
  `zcode\.z\.ai`、`cdn-zcode`、`chat\.z\.ai`、`zhipu-account`、`com\.zhipu`。
- 扫描范围：git 跟踪文件；二进制按扩展名 denylist 跳过（保险措施；当前五模式在
  二进制/lockfile/`.agents`/`third-party` 均零命中，不做额外排除）。
- 结构性排除：`CHANGELOG.md`（release-it 生成物）、`VENDOR-PURGE-PLAN.md` 与
  `specs/`（审计文档必须引用其所禁字符串）。
- Allowlist（文件 + 模式 + 理由，逐条显式；负向断言测试必须包含字面量才能断言其不存在）：
  1. `packages/shared/test/endpointWebPurge.test.ts` —— 断言 `com.zhipu` 不回流。
  2. `packages/shared/test/pluginMarketplacesP5.test.ts` —— 断言 `cdn-zcode.z.ai`
     不回流。
  3. `packages/services/test/providerVendorAccessExcision.test.ts` —— 厂商访问清除
     守卫断言。
- 行为：`--list` 打印全部命中及其豁免归类；默认严格模式，存在未豁免命中即
  `exit 1` 并逐条列出 文件:行号:模式。
- 接线：root `package.json` `verify:pre-push` 末尾追加；PR CI 独立 job；单测
  `scripts/check-vendor-free.test.mjs`（合成语料，不自扫仓库）；注册 knip entry；
  零运行时依赖（不扰动三方 notices）。

## PR CI（`.github/workflows/ci.yml`，净新增）

- 触发：`pull_request` + `push: main` + `workflow_dispatch`。
- Job 与内容：
  1. root 检查：`pnpm typecheck` / `lint` / `fmt:check` / `architecture:check --changed`。
  2. CLI 检查：`apps/zcode-cli` 为独立 pnpm workspace，先单独 install，再
     typecheck / lint / format:check / registry:check（PATH 含 root
     `node_modules/.bin` 供 turbo）。
  3. 单测：各包 `npm test`（shared/ui/services/desktop/server）+ scripts 测试
     （显式 `node --test scripts/check-vendor-free.test.mjs
     scripts/flat-asset-names.test.mjs` —— scripts 测试此前无任何 runner）。
  4. vendor-free gate：`node scripts/check-vendor-free.mjs`。
  5. e2e：先 `pnpm exec playwright install --with-deps chromium`，再
     `pnpm test:e2e`（套件自身先 build web，保持既有顺序）。
- 环境：复用 release workflow 模式 —— `pnpm/action-setup@v4`（读 packageManager
  pnpm@10.33.2）→ `actions/setup-node@v4` node 24.14.0 + `cache: pnpm` →
  `pnpm install --frozen-lockfile` 且 `HUSKY: "0"`。
- 不入 PR CI：`smoke:windows-bundle`（Docker/15GiB，发布链路专用）、`knip`
  （set-diff 语义不适合 CI）。
- 推送 workflow 改动前本地跑一次 smoke（仓库规则字面要求覆盖任何工作流改动）；
  `release-desktop.yml` / 打包脚本零改动。

## 关联清扫裁决（详见各自 spec 的 P6 修订）

- `specs/agent-identity-and-tooling-purge.md`：撤销 "保留 both-strings decode"
  Keep 裁决（删除 `"glm"` 字符串，保留 `"zcode"` 与分支语义；补 decode 单测）。
- `specs/distribution-and-updates.md`：builtinSkillI18n 仅保留 superpowers 归属标记；
  已知市场记录改为严格形状校验 + 旧格式记录加载即丢弃（见该 spec P6 修订）。

## 验收

- `node scripts/check-vendor-free.mjs` 严格模式零未豁免命中（`--list` 全绿）。
- 新 CI 在 PR 上全绿（五个 job）。
- 全门禁矩阵绿：root typecheck/lint/fmt:check/architecture/knip、CLI 四检查、
  各包单测 + scripts 测试、e2e、vendor gate。
- alpha.10 RC 发布：首次真实 in-app 更新 alpha.9→alpha.10 通过；P3/P4 遗留两项
  手测（off-peak 全新安装调度；MCP 搜索覆盖搜索类任务抽查）。
