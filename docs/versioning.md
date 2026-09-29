# 版本与发布规则

Zodex 的版本号自 3.14.3 起独立于上游 ZCode，只表达 Zodex 自身的进度。本文是版本政策、
alpha 发布流程与上游合并 runbook 的正式记录；上游合并的逐次账本见
[upstream-sync.md](upstream-sync.md)，用户侧更新行为见 [updates.md](updates.md)。

## 词汇表

- **alpha 版本**：版本号带 `-alpha.N` 后缀的预发布（如 `3.14.4-alpha.2`），发布为
  GitHub prerelease；仅“接受提前收到预览版更新”开启（或已在运行 alpha）的客户端会收到。
- **正式版（official）**：不带后缀的版本（如 `3.14.4`）。
- **Preview 身份（flavor）**：与发布通道无关的构建期安装包身份
  （`ZCODE_PREVIEW_IDENTITY=1` → "Zodex Preview"，独立 appId/数据目录，不自动更新）。
  不要与 alpha 版本混淆。

## 版本规则

- **独立且单调递增**：每个新发布版本号必须大于此前所有 Zodex 版本，也必须大于已合并的
  任何上游 ZCode 版本（避免与上游撞号产生歧义）。
- **默认节奏（patch）**：一个功能**完整交付**时 bump patch（如双向文件同步完整落地 →
  `3.14.4`）。minor 留给刻意规划的里程碑，major 用于破坏性变更。
- **半成品只上 alpha**：进行中的功能以 `<目标版本>-alpha.0、-alpha.1、…` 递增发布；
  正式版只在"release train"（main 上自上一个正式版起累积的全部变更）中的用户可见功能
  都已完整时才切出，因此正式版不含半成品，也不需要 feature flag。
- **hotfix 例外**：正式版的紧急修复从该正式版 tag 拉分支，仅挑选修复 commit，发布
  `X.Y.Z+1` 后合回 main。这是唯一允许 cherry-pick 的发布场景。
- 版本唯一来源是根 `package.json`，由 release-it 维护；CLI（`apps/zcode-cli`）版本独立，
  不随桌面版本联动。

## Alpha 发布（按需）

**触发**：无固定节奏、CI 不自动打 tag。当有值得测试的内容（测试者要包，或一段工作刚
落地）时，由维护者在干净 main 上执行一次发布命令。

**命令**：`pnpm release:alpha --increment=<显式版本>`（= `release-it --preRelease=alpha
--ci --increment=X.Y.Z-alpha.N`，与正式版同一链路：升版本、重新生成 license notices 与
`CHANGELOG.md` 小节、提交 `chore: release vX.Y.Z-alpha.N` 并推送 tag）。
⚠ 2026-09-29 实测（incident：v3.15.0-alpha.0 误切 train，已回滚）：本仓库的 release-it
配置下**必须显式传 `--increment`**——

- 续 train（`3.14.4-alpha.0` → `3.14.4-alpha.1`）：`pnpm release:alpha --increment=3.14.4-alpha.1`
  （完整版本号；`--increment=prerelease` 实测同样会 minor 跳 train，不可用）；
- 新 train 首个 alpha（`3.14.3` → `3.14.4-alpha.0`）：`pnpm release:alpha --increment=patch`；
- 不带 `--increment` 的裸 `pnpm release:alpha` 会 minor 跳 train（如 3.14.4 → 3.15.0-alpha.0），**禁止**。
  与正式版相同：发布前先 `--dry-run` 预览版本号（⚠ dry-run 经 npm version 副作用会把版本写进
  `package.json`，预览后必须 `git checkout -- package.json` 还原再正式执行）。

**构建与交付全自动**：tag 推送触发 `release-desktop.yml`（对任何 `v*` 生效），产出全
平台安装包与 remote 资产并挂到 GitHub Release；tag 含 `-` 自动标记 prerelease。测试者
无需手动安装：客户端按小时轮询 + 手动“检查更新”，经 `latest.yml` 收到下一个 alpha。
每个 alpha 是 main 当时的整体快照，可同时包含多个进行中的功能，并被下一个 alpha 取代。

## 上游（ZCode）合并

上游仓库：`https://github.com/zai-org/ZCode`。合并是低频操作：**在 release train 边界
批量进行**（刚切出正式版之后），不要在功能进行中插入。

1. **拉取（避免 tag 撞号）**：fork 与上游都存在 `v3.14.3` 等 tag，禁止直接
   `fetch --tags`。用私有 refspec：
   `git remote add upstream https://github.com/zai-org/ZCode.git`（仅首次）；
   `git fetch upstream '+refs/tags/*:refs/remotes/upstream/tags/*'`。
2. **合并**：从 `refs/remotes/upstream/tags/vX.Y.Z` 整树 `git merge --no-ff`，commit
   信息固定为 `merge: upstream ZCode vX.Y.Z`（**不带 body**——changelog 中 Upstream
   分节按单行渲染，细节写进账本）。选择性排除 = 先整树合并、再在合并中撤销不需要的
   部分；不要 cherry-pick（merge base 不前移，冲突会永久重复）。
3. **冲突热点**（按处理顺序）：
   - `patches/`（patchedDependencies）：patch 应用失败会直接阻塞安装，先重放/重写 patch；
   - `pnpm-lock.yaml`：取上游后重放根 `package.json` 的 `pnpm.overrides` 与
     `patchedDependencies` 并重新 `pnpm install`；
   - 被本 fork 删除的厂商文件：上游若修改了它们（modify/delete 冲突），一律保持删除；
   - `.github/workflows/`、`scripts/`（含 `check-vendor-free.mjs`）、
     `electron-builder.config.js`、`apps/zcode-cli/`、`third-party/` notices、品牌字符串
     （Zodex rebrand）：逐一恢复本 fork 形态。
4. **守卫全绿后才能打下一个 alpha**：`pnpm verify:pre-push`（lint + 架构检查 +
   vendor-free 扫描）、`pnpm typecheck`、desktop 单测；大合并后视情况
   `pnpm architecture:baseline:update`；动了依赖要重跑
   `node scripts/licenses.mjs notices`；动了 CI/打包链路先
   `pnpm smoke:windows-bundle`。
5. **登记账本**：在 [upstream-sync.md](upstream-sync.md) 追加一行（日期 / 上游版本 /
   合并 commit / 纳入与排除范围 / 首个包含它的 Zodex 版本）。
6. **版本约束**：合并的上游版本若 ≥ 计划中的下一个 Zodex 版本号，Zodex 目标版本必须
   抬高到其之上。每个 `v*` tag（含 alpha）照常携带完整 remote-asset 集。

## 参考

- 更新通道用户侧行为与镜像限制：[updates.md](updates.md)
- 通道语义与 allowPrerelease 规则（P8 修订）：[../specs/distribution-and-updates.md](../specs/distribution-and-updates.md)
