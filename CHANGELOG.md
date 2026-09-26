# Changelog

本文件由 `pnpm release`（release-it + conventional-changelog）自动生成并维护。
详细变更通过 conventional commit 消息体中的 bullet 列表描述；禁止手工 `git tag` 发版，
否则会跳过本文件的生成（v3.14.3 曾因此缺失自动生成的条目，下节为事后补录）。

## 3.14.3 (2026-09-25)

首个开源版本快照；此前的内部版本历史不在本仓库追踪范围内。以下条目为事后补录。

### Features

- **repo:** open-source snapshot of ZCode 3.14.3 (29628c9)
  * desktop (Electron main/host/renderer), web, server, shared UI/services/rpc/client packages
  * Agent CLI and runtime source in apps/zcode-cli (regular directory, no submodule)

### Chores

- **ci:** add Windows x64 installer release workflow (be58138)
  * GitHub Actions workflow `Release Desktop` triggers on `v*` tag push
  * builds the unsigned NSIS installer (`ZCode-<version>-win-x64.exe`) on windows-latest and attaches it to the GitHub release
  * production identity via `ZCODE_ENV=production`; remote runtime assets skipped (`ZCODE_SKIP_REMOTE_ASSETS=1`)
