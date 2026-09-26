# Changelog

## [3.14.3-alpha.2](https://github.com/yeyuan98/ZCode/compare/v3.14.3-alpha.1...v3.14.3-alpha.2) (2026-09-26)

### Features

- **p2:** vendor-neutral onboarding, web token login, GitHub Issues feedback ([d644ed1](https://github.com/yeyuan98/ZCode/commit/d644ed17efcfe0541ff00bbab1e7dd5d42afa8d6))
  - startup gate now opens the wizard iff no usable provider AND not dismissed;
  - new optional AppSettings field providerOnboardingDismissedAt (skip persistence;
  - guard waits for BOTH settings and model-selection hydration, with error escapes
  - welcome wizard replaces the vendor OAuth screen: full template catalog (all
  - useOAuth hook and vendor OAuth login UI deleted
  - packages/web gains a same-origin token login page (token entry, editable server
  - in-app feedback center fully deleted (20 UI files, IFeedbackService, vendor HTTP
  - every report entry (help menu, quickpick, error banners, task rows/menus,
  - config: feedback_url -> GitHub Issues, zh-CN community -> GitHub Discussions,

### Chores

- **lint:** clear all format/lint baseline debt in both workspaces ([1074e7d](https://github.com/yeyuan98/ZCode/commit/1074e7dd977a17a78dc074fc80a5fda85bdc24f8))
  - new apps/zcode-cli/.oxlintrc.json (max-lines off, P6+ split debt), dynamic-workflow

- **p0:** format/lint follow-up — zero new warnings vs baseline ([9b052bc](https://github.com/yeyuan98/ZCode/commit/9b052bca5e9f7b408298767f830f6e8d2af59627))
  - 修正 P0 引入的格式回归：VENDOR-PURGE-PLAN.md、specs/telemetry-and-update-policy.md、
  - 清理 P0 删除消费端后遗留的 unused 标识：index.ts(hostname/getDataBaseDir)、
  - release-it 增加 after:bump hook：版本写入 package.json 会改变 notices 门禁
  - 实测对比基线 53b17b3：fmt 失败文件 35→34（无新增）；lint warnings 70→58

### Documentation

- **spec:** P2 onboarding & gate spec + master-plan corrections ([e11c377](https://github.com/yeyuan98/ZCode/commit/e11c3776eae09c6c8702c0fed6ddb2b3a41763b0))
  - add specs/onboarding-and-gate.md: gate rule, wizard flow, web token login, feedback policy, ownership invariants
  - master plan §5: record binding alpha policy (development-first, no alpha-to-alpha compat)
  - master plan P2: fix ZCODE_SERVER_TOKEN→ZCODE_SERVER_AUTH_TOKEN, mislabeled remoteWorkspaceServiceCollection token (share auth → P5), migration file moves P1→P2, feedback deletion scope + community decisions
  - master plan §2.7: correct server auth env name

## 3.14.3-alpha.1 (2026-09-26)

### Features

- open source ([872ad96](https://github.com/yeyuan98/ZCode/commit/872ad960de7ec172591f7e1952f7849229f94521))

- **p0:** remove vendor telemetry (ARMS RUM + 数仓) and disable vendor update paths ([3e29bdc](https://github.com/yeyuan98/ZCode/commit/3e29bdc5a11d8abfeb3ceeeebb6c2cd8b0de1688))
  - 删除 Alibaba ARMS RUM 遥测链路：appARMSBootstrap、arms\* 桥接/脱敏/身份、
  - 删除 数仓事件上报：services telemetryCore、桌面/渲染层全部 funnel sender、
  - deviceMid 去持久化：desktop 不再读写 telemetry-state.json，改为进程内临时
  - 新增 packages/shared/updateFeedPolicy：厂商 manifest feed 期间禁用三条更新
  - crash capture 改为本地归档；host 内存诊断保留本地日志
  - third-party 清单再生成：移除 @arms/@rrweb/rrdom/keyv 依赖与 overrides，
  - 清理死代码：write-only 窗口集合、空 import、5 个孤儿模块、onAccepted 残参
  - 新增 specs/telemetry-and-update-policy.md、VENDOR-PURGE-PLAN.md 与

- update v3.14.3 ([29628c9](https://github.com/yeyuan98/ZCode/commit/29628c9acdb81b703bbd4080c207a0e7ce5e276e))
  - The concurrency limit of a running workflow can now be adjusted directly, without stopping the task.
  - Optimized the reuse logic when modifying and restarting workflows.
  - Improved the real-time status display for large workflows.
  - Improved the efficiency of workflow script submission and modification, reducing token consumption.
  - Fixed an issue where workflows could cause the interface to crash in some cases.
  - Fixed an issue where buttons on workflow cards were sometimes pushed out of the interface.
  - Fixed an issue where the workflow tool took up too much context.

### Bug Fixes

- **cli:** localize resource-sample interval after shared telemetry contract removal ([d3f3161](https://github.com/yeyuan98/ZCode/commit/d3f316197b7bc70b964eab8836f41ae914787ead))
  - P0 删除 shared processResourceTelemetry 契约后，CLI bootstrap 的
  - 采样周期常量本地化（60_000，与原值一致）；ZCodeProcessResourceSample 类型
  - app 侧接收端已随 P0 移除，sampler 协议通知暂无消费者；协议面清理留待 P4/P6
  - 验证：pnpm smoke:windows-bundle 通过（ZCode-3.14.3-win-x64.exe, 141.4 MiB）

### Chores

- add local Windows bundle smoke tool and release runbook ([53b17b3](https://github.com/yeyuan98/ZCode/commit/53b17b3e18cb9c7fbbed7f97fa0f099ac0cfd687))
  - add scripts/smoke-windows-bundle.mjs + scripts/docker/Dockerfile.windows-cross: reproduce the release-desktop.yml Windows build locally in Docker (wine + wine32:i386 for NSIS makensis, rsync for --skip-install fast reruns)
  - run outputs live in ~/temp/zcode-smoke/<run-id>/ and are removed by default; pnpm/electron caches and the build workdir persist in a Docker named volume; base images are never pruned and the project image is kept unless --prune-image
  - new entry points: pnpm smoke:windows-bundle and mise task smoke-windows-bundle
  - seed CHANGELOG.md with a backfilled 3.14.3 section in the release-it writer format; detailed changes are tracked as commit body bullets going forward
  - document the release runbook in README/README.en/AGENTS.md: pnpm release is the only sanctioned release entry (bumps version, generates CHANGELOG, tags vX, triggers the installer workflow); manual git tag releases are forbidden

### Other Changes

- Initial commit ([77432b6](https://github.com/yeyuan98/ZCode/commit/77432b6dbf9f70176ced3f4dcdc25f851c3acb2d))

本文件由 `pnpm release`（release-it + conventional-changelog）自动生成并维护。
详细变更通过 conventional commit 消息体中的 bullet 列表描述；禁止手工 `git tag` 发版，
否则会跳过本文件的生成（v3.14.3 曾因此缺失自动生成的条目，下节为事后补录）。

## 3.14.3 (2026-09-25)

首个开源版本快照；此前的内部版本历史不在本仓库追踪范围内。以下条目为事后补录。

### Features

- **repo:** open-source snapshot of ZCode 3.14.3 (29628c9)
  - desktop (Electron main/host/renderer), web, server, shared UI/services/rpc/client packages
  - Agent CLI and runtime source in apps/zcode-cli (regular directory, no submodule)

### Chores

- **ci:** add Windows x64 installer release workflow (be58138)
  - GitHub Actions workflow `Release Desktop` triggers on `v*` tag push
  - builds the unsigned NSIS installer (`ZCode-<version>-win-x64.exe`) on windows-latest and attaches it to the GitHub release
  - production identity via `ZCODE_ENV=production`; remote runtime assets skipped (`ZCODE_SKIP_REMOTE_ASSETS=1`)
