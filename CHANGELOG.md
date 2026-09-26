# Changelog

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
