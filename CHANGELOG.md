# Changelog

## [3.14.3-alpha.4](https://github.com/yeyuan98/ZCode/compare/v3.14.3-alpha.3...v3.14.3-alpha.4) (2026-09-26)

### Features

* **provider:** P1 catalog rework — equal-vendor templates, ollama, zero GLM/websearch rules ([10057e1](https://github.com/yeyuan98/ZCode/commit/10057e11a2608e962e57fdd665a04b8e52636bed))
  * convert zai/bigmodel templates to plain api-key access, de-brand 'Coding Plan' names, drop their builtinModelIds (models now come from discovery/manual add)
  * delete 8 account:* providerRules, all builtinProviderModelRules, all glm-keyed model/template/site rules; strip glm ids from aggregator builtinModelIds (openrouter/opencode-go/opencode-zen)
  * delete zcode.z.ai-keyed site rules; remove supportsNativeWebSearch from all remaining rules (keep inputFormat/supportsMidConversationSystem capabilities for surviving endpoints)
  * add ollama template (openai-chat-completions, http://localhost:11434/v1, no access block)
  * catalog invariant: zero case-insensitive glm matches, zero account:/zhipu/websearch strings (locked by builtinProviderCatalog.test)
  * add services test runner (tsLoader shims + package.json test script; 3 pre-existing tests now gated)
  * default supportsNativeWebSearch=false in ModelPropertiesConfig assembly: catalog no longer carries the flag while the complete schema still requires it (field itself dies in P4)

* **wizard:** P1 model auto-discovery client + wizard persistence ([abf28b6](https://github.com/yeyuan98/ZCode/commit/abf28b6e45e105a63befe26f496354180a0c752a))
  * new providerModelDiscovery.ts absorbs the P2 test-key probe: openai-compat GET {baseUrl}/models (Bearer only when key present), anthropic GET {baseUrl}/v1/models with x-api-key + anthropic-version + after_id cursor paging (10-page cap); proxy-aware fetch, versioned-path normalization, never spawns the agent runtime
  * facade probeTemplateApiKey → discoverTemplateModels (interface, impl, runtime fetch threading, node.ts wiring)
  * CreatePersonalProviderInput.initialModelIds: wizard persists discovered model ids into the created provider (gate requires models.length>0; template providers start empty since P1 dropped vendor builtinModelIds — without persistence the wizard would dead-loop the startup gate)
  * wizard key step: 'test key' → 'test & discover' with model-count feedback; key-less templates (ollama) skip the key input and discover unauthenticated; step-aware keyless header copy
  * i18n: login.wizard.testKey* → discoverKey* in both locales (+keylessStepDescription)
  * e2e: updated test&discover assertions + new wizard-complete⇒usable (gate-closed) lock


### Bug Fixes

* **p1:** apply ulw review fixes (empty-list policy, CLI login residue, e2e locks) ([dd6db8f](https://github.com/yeyuan98/ZCode/commit/dd6db8f8693c84b91832361d92e7635d091f65aa))
  * discovery: empty model list now degrades to failure ('no models returned') per spec — avoids misleading 'works · 0 models' saves that would reopen the wizard gate on next startup; unit tests added (empty list, anthropic /v1-prefixed baseUrl normalization, abort timeout)
  * e2e: failure test extended to save-after-401 and assert the wizard closes (spec acceptance 3); teardown ENOTEMPTY race fixed with bounded retries (SQLite handle release vs rm)
  * catalog: bigmodel-api key-management URL repointed to the real API-key console (was coding-plan overview)
  * CLI: remove P1-dead login residue — help lines (login/logout commands, --no-browser, /login //logout), command-center /login //logout branches + deps + login-flow.ts + loginSetup i18n block/types (both locales); loginRequired copy reworded to provider-API-key guidance (no /login mention)
  * spec: §4 kept-until-P3 list corrected (legacyAccountConnectionSettings + legacyTeamOrganizationResolver died fully dead in slice 1); expected-death list extended (CLI account-login surface, custom-path zero-model saves); e2e README wording


### Chores

* **fmt:** exclude generator-owned CHANGELOG.md from oxfmt ([0ed9c86](https://github.com/yeyuan98/ZCode/commit/0ed9c862237b81ad61c1ef39867d7c79125b4cac))

* **fmt:** format spec markdown ([841a318](https://github.com/yeyuan98/ZCode/commit/841a318d70c7f4927814482e37db2209107f9873))

* **knip:** remove P1-fanout orphaned files and exports ([f81e2b7](https://github.com/yeyuan98/ZCode/commit/f81e2b77882de689acddbbe2bb74d1fed44c107b))
  * delete dead files (consumers died in slices 1-2): codingPlanProviderAvailability, bigmodelStartPlanZcodeJwt, providers/api barrel + apiKeyHeaders, ui oauthTeamPricing
  * unexport/delete orphaned symbols (zaiStartPlanBilling model list, coding-plan login headers, sidebar usage preference writer, footer badge helpers, ModelProviderSection test-support re-exports, CLI server/run type re-exports)
  * knip gate: zero genuinely-new entries vs branch-point baseline; 21 baseline entries eliminated


### Documentation

* **plan:** record P1 delivery, amendments A1-A4, decision D8; re-shift alpha numbering ([5443413](https://github.com/yeyuan98/ZCode/commit/544341346552e8bbf5704da311bfd74c47aa0b63))
  * P1 section: delivered summary (catalog/discovery/excision/tests/amendments)
  * §3: D8 = compile-forced natural death / no pre-hiding / no over-deletion (was mis-cited as D5)
  * P3→alpha.5 … P6→alpha.8 (RC); matrix rows updated (A3 = P2 hotfix, A4 = P1)

* **plan:** record wizard UX hotfix alpha.3; P1 shifts to alpha.4 ([634cc60](https://github.com/yeyuan98/ZCode/commit/634cc60df79ad54636d64575f371d6564bd7ba1f))

* **spec:** P1 provider catalog & model discovery spec ([4b1a9aa](https://github.com/yeyuan98/ZCode/commit/4b1a9aa6c4279aa88073c22f80c7055dc961dbbc))
  * new specs/provider-catalog-and-discovery.md: 21-template equal-vendor catalog invariants (zero glm matches, zero account providers, zero websearch props), runtime model discovery contract (openai-compat + anthropic /v1/models, no agent spawn), wizard test-and-discover with mandatory model persistence, schema excision scope incl. P3 retention boundary, expected-death list, migration boundary
  * amend specs/onboarding-and-gate.md §Behavior 3: P2 test-key probe superseded by P1 discovery client

* **spec:** wizard layout/header contract (alpha.3) + implemented status ([ae78e69](https://github.com/yeyuan98/ZCode/commit/ae78e69b79b992e80478de06c8b1cc631dd71488))


### Refactorings

* **cli:** delete GLM selection backfill migrations 0020-0022 (P1 hard-cut) ([5627a4c](https://github.com/yeyuan98/ZCode/commit/5627a4cfe125a76eed4a2b181974b26c0ae30203))
  * remove the three tail SQLITE_MIGRATIONS entries + their SQL imports/files: 0020 provider-model-selection backfill, 0021 official-glm-selection id recasing, 0022 backfilled-session-reasoning repair (joins 0020's ledger row — one unit, all three go)
  * checksum-ledger runner iterates only present entries: safe for fresh and existing databases
  * ledger comment: ids 0020-0022 must never be reused with different SQL (old databases carry checksums for the original SQL); next migration starts at 0023

* **history:** delete GLM id/migration history (P1 slice 3, hard-cut) ([478a2dd](https://github.com/yeyuan98/ZCode/commit/478a2ddc89685af26d744c06f1bd20922c40a2bb))
  * delete official-glm-model-id.ts + legacy-model-provider-identity.ts: migrateLegacyModelProviderId existed solely to map six zai/bigmodel legacy ids — deleted; subagent state/markdown migrations keep pure format conversion; bots migrateSelection drops dead builtin: selections (same semantics as the old unknown-builtin branch)
  * remove no-op user-markdown migration walker (existed only for the provider-id rewrite) across services + CLI
  * delete official-glm-selection-v3.ts + its 0003 registration in services tasksDatabase migrations (import, definitions entry, dispatch branch; ledger ignores stale 0003 rows; id never reused — noted in comment)
  * legacyZCodeConfigProviderReader: vendor parts only removed (preset GLM id set, BigModel anthropic normalization, runtime-URL kind inference, BigModel endpoint branches); generic config.json importer intact + regression test (former vendor preset id routes generically with declared kind + verbatim baseURL)
  * zaiStartPlanBilling inlines its canonical start-plan model list (shared file gone; billing file itself is P3 deletion scope)

* **provider:** excise zhipu account access types + overlay; adapt CLI (P1 slice 2+2b) ([53f9a20](https://github.com/yeyuan98/ZCode/commit/53f9a20c2be77aa3b2abd04a00188d2ca6a6ab20))
  * delete zhipu-account/zhipu-coding-plan-api-key zod literals (access is api-key only), ZhipuAccountAccessConfig class, account overlay layer (account-provider-resolution/service/state, accountProviderConnectionResolver/Invalidation), account branches across config-service/resolver/registry-service/facades/sources/effective-model-selection
  * services wiring: node.ts/zcodeAgentService.ts account-config sync to agent removed; resolveCurrentAccountAccess/resolveAccountProvider become inert nulls (registry can no longer publish account providers); provisioning account-provider scope dropped (shared provider-provisioning.ts)
  * CLI (compiles against root packages via symlinks): delete standalone-account-provider-runtime + compile-forced chain (auth-login*, tui-auth, login-command, zcode-protocol/account-provider-config, login/logout dispatch) — these died with the account runtime; /login /logout surface gone transitively
  * runtime-string sweep: zero zhipu-account/zhipu-coding-plan literals outside protected shared protocol schemas (kept until P3 per master-plan amendment A1)
  * new providerVendorAccessExcision.test.ts: schema rejects both vendor access types; stale personal.json with vendor access fails whole-file parse (containment per spec)
  * protected P3 domains untouched: oauth/**, coding-plan-subscription/**, usage-stats/**, offPeakRuntimeModel, codingPlanProviderAvailability, accountProviderApiClient/CredentialService chain, protocol account schemas

* **settings:** delete providerFamilyDomain* field family + providerFamilyConnectionSelections (P1 slice 1) ([fa9dce2](https://github.com/yeyuan98/ZCode/commit/fa9dce2c2cac9799832c113e4aee7e222193378f))
  * remove providerFamilyDomain/providerFamilyDomainUpdatedAt/providerFamilyDomainMigrated/providerFamilyConnectionSelections from validationAppSettings (both schemas), protocol AppSettings, normalizeSettingsPatch, setting broadcast keys, settingService comparisons
  * compile-driven UI fan-out (~30 files): coding-plan Connect/Upgrade visibility, sidebar usage summary sections, composer start-plan quick-select, off-peak eligibility reads, account-connection-loss suggestion, plan-mode switch persistence all die with the field (per spec expected-death list; off-peak/account entitlement becomes inert until P3)
  * P3-scoped services: surgical read-removal only (codingPlanProviderAvailability team context constant-unknown; accountProviderConnectionResolver constant-null access; provisioning envelope drops accountSettings member; settingService legacy import/rollback machinery deleted — legacyAccountConnectionSettings + legacyTeamOrganizationResolver existed solely to feed the deleted field and are removed whole)
  * delete UI libs that existed only for the field (providerFamilyDomainSettings, modelProviderFamilyConnectionSelection, oauthProviderFamilySelectionRefresh, accountConnectionLossSuggestion)
  * i18n: 6 orphaned keys removed from both locales (usage/connection-suggestion strings)
  * old setting.json keys strip harmlessly on parse (verified runtime lenient parse; no migration per alpha policy)

## [3.14.3-alpha.3](https://github.com/yeyuan98/ZCode/compare/v3.14.3-alpha.2...v3.14.3-alpha.3) (2026-09-26)

### Bug Fixes

* **wizard:** bounded scrollable layout, per-step headers, window controls ([ab586f7](https://github.com/yeyuan98/ZCode/commit/ab586f7c262859e5b3b53459a4103891c9a19449))
  * rework wizard shell to the OccupationOnboarding fullscreen idiom: pt-12 drag-bar
  * render DesktopWindowControls on Win/Linux (frameless window had none)
  * headers now step-aware: key step shows chosen provider name + logo chip +
  * remove redundant inner form headings (incl. orphaned login.apiKey.title and
  * autoFocus key/name inputs on step entry; template-lookup miss falls back to
  * e2e: provider-name heading assertion + new wizard-scroll.spec.ts layout
  * format CHANGELOG/plan files regenerated by the alpha.2 release (fmt parity)


### Documentation

* **plan:** mark P2 delivered as v3.14.3-alpha.2 ([43bb3e0](https://github.com/yeyuan98/ZCode/commit/43bb3e07569058dc280e791835cf8a074da43932))
  * status header: P0+P2 done, next P1
  * P2 section: delivered summary (gate/wizard/probe/web login/feedback/e2e/lint-debt)
  * A2 matrix row: delivered test counts

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
