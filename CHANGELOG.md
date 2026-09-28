# Changelog

## [3.14.3-alpha.8](https://github.com/yeyuan98/ZCode/compare/v3.14.3-alpha.7...v3.14.3-alpha.8) (2026-09-28)

### Features

* **p4-b:** delete WebSearch tool + supportsNativeWebSearch + providerNative mechanism ([d63aae0](https://github.com/yeyuan98/ZCode/commit/d63aae0a16978c835d5e1f236c5c181cccc24826))
  * delete websearch handler/contract files and all registry/barrel/subpath-export entries
  * remove anthropic-only provider-native encoding branch + helpers + option feeders in adapters
  * remove required per-model field supportsNativeWebSearch across shared/provider/prompt-trajectory (hard cut per spec Ruling 2; strict parse rejects old configs, no normalization)
  * remove tool from name-keyed lists: tool-identity known names, explore tools, microcompact, permission read-only, explore profile, provider-visible order, tool alias map (now identity), scheduler, subagents defaults, UI tool options, CLI argument alias rewrite
  * remove identity-mapped telemetry enum pair (agent-execution + model-api operation + querySource case)
  * excise providerNative tool mechanism (contracts tool contract fields, model contract passthrough, core registry/types)
  * remove UI metadata-editor field, i18n key + capabilities help bullet (both locales), NOTICE.md WebSearch sentence
  * keep: webSearchRequests usage accounting, 'search' tool family, embedded-search, catalog glm-free invariant test
  * tests: shared toolIdentity (no WebSearch + search family intact); services schema-rejection of removed field; fix providerModelDiscovery personal-path isolation (resolve after setDataBaseDir)

* **p4-c:** delete coding-plan gateway, start-plan error cluster, ModelRequestAuth chain, dead vendor residue ([630a19e](https://github.com/yeyuan98/ZCode/commit/630a19ee2e801fcedb5968b97acf7c9cbb03ddcd))
  * delete official-coding-plan-gateway.ts + model-execution transport cache/wiring + barrel export; zai/bigmodel templates now connect directly to configured base URLs (NOTICE.md gateway row removed)
  * delete start-plan 3008/3009/3010 cluster: streaming-recovery sets/helpers, turn-model-step admission-retry branch + start_plan_admission_retry_discarded, target-completion-verification retry loop, failure-code entries (generic 429 path absorbs), UI providerBusinessError entries + i18n 3008/3009/3010 + dead 3102 + dead team-plan code/keys
  * delete dead OffpeakQueued retry reason + all consumers (telemetry recorder, governor, product-projection, dynamic-workflow, UI throttle map + keys); old replays may render raw codes (documented degradation)
  * delete inert ModelRequestAuth chain end-to-end: contracts types + ModelRequestAuthMissing code, core attach sites + port machinery, adapters runner-runtime chain (incl. runner-runtime-headers.ts), bootstrap port, desktop protocol schemas/methods, host fast-fail handler; session-title dead deferral gate removed (titles now generate on normal schedule)
  * delete phase-3 residue: /login redaction regex in tui app-submit, history.ts api-key pattern, login/logout slash-command union members + argv routing, shared-credentials vendor keys/types/methods (generic MCP OAuth store kept), unreachable account-plan model-selection branch + union + mapping
  * neutral-rename bracketed business-code parser symbols/comments (behavior kept)
  * tests: shared zcodeProtocolP4Purge guard (protocol no longer exports runtime-headers methods/schemas)

* **p4-d:** rename agent provider identity glm -> zcode end-to-end ([0263400](https://github.com/yeyuan98/ZCode/commit/0263400b88f5b03f51891f3f2cf175aaf1ac4ece))
  * flip both provider literals in one commit (providers.ts ZCODE_PROVIDERS + zcode-task-types-core ZCodeProvider) + ZCODE_AGENT_PROVIDER const; rename task event glm_agent_model_state_update -> zcode_agent_model_state_update + ZCodeGlm* type names (desktop-internal literal)
  * outbound identity headers: X-ZCode-Agent: zcode; HTTP-Referer vendor platform origin -> repo URL (https://github.com/yeyuan98/ZCode)
  * env/dir rename in lockstep: GLM_BINARY_PATH -> ZCODE_AGENT_BINARY_PATH + bundled/remote dir glm/ -> zcode/ via shared descriptor; desktop env writer now derives from descriptor (single-source invariant); resolveBundledGlmBinaryPath -> resolveBundledAgentBinaryPath; deploy paths, remote package id, glm-content cache id, windows install locks, electron-builder from/to + signIgnore, prepare-prebuilds/stage-agent-bundle/prepare-agent-node-bundle/koffi scripts (old asset ids kept in nonReusableReleaseAssetIds history + new ids added)
  * skill prefix glm: -> zcode: producer + UI filter/permission map/display-help keys + 16 mode.* i18n keys both locales (atomic flip; enablement stays path-keyed)
  * icons: GlmMonochromeIcon -> ZcodeMonochromeIcon + icon assets renamed; orphan icon-glm.png deleted; third-party/inventory.json regenerated via licenses script
  * literal sites: task adapter alias, skills service, host WSL release, legacy remote allowlist query (hard cut, persisted rows orphaned per Ruling 1), task-model recovery (hard cut + 中文注释), bots mode-label key; comment rot updated where touched
  * tests: update 3 glm-asserting tests; add shared agentIdentityInvariants (provider/env/dir/event values) + ui skillReferencePrefixContract

* **p4-e:** rename zai themes to zcode, neutral WebFetch UA, neutralize vendor-citing comments ([056ee0e](https://github.com/yeyuan98/ZCode/commit/056ee0ed33b3526e9c0778a0641da55f689538ab))
  * rename theme ids zai-dark/zai-light -> zcode-dark/zcode-light across ui/web/desktop (93 replacements, 23 files: type/normalize/fallback, CSS classes, persisted default, settings config/sidebar, diff/mermaid/message/preview surfaces, palette, logo, i18n keys both locales, web seed + share route + index.html, desktop renderer/resource-manager); no old-value fallback (stored themes reset once, 中文注释 at fallback)
  * WebFetch User-Agent URL -> https://github.com/yeyuan98/ZCode (was vendor domain)
  * neutralize vendor-citing comments on kept behavior: compact empty-length finish guard, tool_result image-block ordering, workflow submit_result coercion, browser locator stable-pointer note


### Bug Fixes

* **p4-review:** apply [ulw] review fixes — durable theme reset, proxy/CA fetch memo, spec amendments ([1489271](https://github.com/yeyuan98/ZCode/commit/14892714a039b19adbeeeda091f0b14eb6226021))
  * theme hard-cut made durable: pre-hydration readers (desktop renderer main, resource-manager window, web index.html bootstrap) validate stored theme and write back zcode-dark once; useTheme fallback persists — reset now happens exactly once instead of recurring first-paint flash
  * model-execution: instance-level proxy/CA fetch memo restores single CA read (lost with gateway transport cache deletion); business-error wrapper reuses memoized network fetch
  * neutralize two stale 'Zai dark' comments (desktop renderer main, web main)
  * spec amendments: A-P4.1 descope CLI-infra-dependent test units (compensating guards recorded), A-P4.2 accepted degradations (HTTP-200 SSE 3008 terminal-unknown; personal-config whole-file degradation under Ruling 2; offpeak_queued raw replay), A-P4.3 review fixes


### Documentation

* **plan:** A7 matrix row — delivered test counts + pending manual-pass note ([573bd66](https://github.com/yeyuan98/ZCode/commit/573bd668cf984e483856a5d126dca85fb059ee94))

* **plan:** record P3 merge/release hashes (b508f3c / 020f430 / v3.14.3-alpha.7) ([2e82768](https://github.com/yeyuan98/ZCode/commit/2e82768782f2551fe5f3b70bd8780cb720ce43d9))

* **spec:** P4 design of record — agent identity rename + WebSearch/gateway purge ([6df4204](https://github.com/yeyuan98/ZCode/commit/6df4204fc9216da1534122c041a5039666b8d854))
  * add specs/agent-identity-and-tooling-purge.md as P4 (alpha.8) spec
  * record rulings 1-8 incl. hard-cut for old glm data/configs (no migration, no config normalization)
  * define rename lockstep invariants (provider literal, env/dir descriptor, skill prefix, packaging scripts)
  * protect keep-lists: webSearchRequests accounting, search tool family, catalog GLM rules, BigModel ordinary error codes
  * test matrix incl. mandatory windows-bundle smoke (installer layout change)

## [3.14.3-alpha.7](https://github.com/yeyuan98/ZCode/compare/v3.14.3-alpha.6...v3.14.3-alpha.7) (2026-09-27)

### ⚠ BREAKING CHANGES

* replace remote builtin-provider catalog download with bundled-only source (P3 C5)
* **desktop:** delete context-prompt rollout + shared client/configs fetcher (P3 C5)
* remove vendor client/configs service + channel; plugin-store order falls back to bundled (P3 C5)
* remove vendor family/specs + de-plan settings provider page (P3 C4)
* **shared,ui:** unpin image-search from default-enabled official plugins (P3 C3, ruling 5)
* remove official MCP service + auth protocol + CLI adapter chain (P3 C3)
* **desktop,shared,web:** remove coding-plan webview/paypal/payment deep-link chain (P3 C2)
* **web:** remove web OAuth auth dir + share landing owner-login (P3 C1)

### Features

* **desktop,shared,web:** remove coding-plan webview/paypal/payment deep-link chain (P3 C2) ([6ea3bb5](https://github.com/yeyuan98/ZCode/commit/6ea3bb503f959e9ca58e472b04da3423fc36a677))
  * desktopWindowChrome: 删除 isPaypalHostname / isCodingPlanPaypalNavigationUrl /
  * desktopMainIpcRemote: 删除重复的 paypal/webview 判定块与 openExternal 的
  * preload/codingPlanWebview.ts + tsup 入口：删除（官网 zcodeBridge 购买完成信号链）
  * deep link: 删除 zcode://payment/callback 路由、pending 缓存与
  * 命令面: 删除 DesktopCommandIds.ClearCodingPlanWebviewStorage 与
  * env: 删除 desktopRuntimeEnv 的 ZAI_BUSINESS_BASE_URL 注入、tsup 的

* **desktop:** delete context-prompt rollout + shared client/configs fetcher (P3 C5) ([e21ceec](https://github.com/yeyuan98/ZCode/commit/e21ceec09c2349d19097663828358548d7d82f16))
  * delete desktopContextPromptRollout.ts (vendor /api/v1/client/configs fetcher + rollout): context-prompt pins its local default OFF (A9), still injected as ZCODE_DESKTOP_CONTEXT_PROMPT_ENABLED=0 so host presentation-surface folding is unchanged
  * delete singleFeatureRollout.ts mechanism (both consumers gone)
  * rendererActionTraceRollout: local disabled constant (env overrides ZCODE_RENDERER_ACTION_TRACE_ENABLED / ZCODE_LOCAL_TTFT_ENABLED and OTLP exporter chain stay live)
  * remove first-host-spawn bounded rollout decision gate (createWindow option + main wiring)

* remove official MCP service + auth protocol + CLI adapter chain (P3 C3) ([7b98a54](https://github.com/yeyuan98/ZCode/commit/7b98a54b961d1a5f678f3ff9363b1e33c9e49941))
  * shared: delete official-mcp-auth.ts (auth-type/header/meta consts, failure-reason
  * shared protocol: drop interaction/requestOfficialMcpAuthHeaders method const +
  * shared v4/contracts: drop mcp_tool display 'unavailable' schema field and
  * services: delete official-mcp/ (credential resolver + issuance audit); remove
  * CLI: delete official-mcp-auth-port.ts + entrypoint/server wiring,
  * UI: delete orphaned mcpUnavailableBannerNotice; drop serverRequestId mapping

* remove vendor client/configs service + channel; plugin-store order falls back to bundled (P3 C5) ([019a4e5](https://github.com/yeyuan98/ZCode/commit/019a4e518af5a38c03833221faf44e38eabc2e75))
  * services: delete client-config service (IClientConfigService + createClientConfigService) and its registration in node.ts; drop accessor field and index export
  * shared: delete clientConfig snapshot parser + ServiceChannels.ClientConfig; pluginStoreOrder keeps local types only (parsePluginStoreOrder dies with the vendor envelope)
  * client/desktop host: remove ClientConfig proxy and remote-workspace passthrough registration
  * ui: usePluginStoreOrder resolves to null order (bundled default ordering from pluginStoreOrdering), refresh becomes no-op
  * spec: record C5 delivery notes (rendererActionTrace shares the dying fetcher; force-update gate read stays until P5)

* remove vendor family/specs + de-plan settings provider page (P3 C4) ([8fc4edd](https://github.com/yeyuan98/ZCode/commit/8fc4eddaec58610dc7a96c665f264709e3558c21))
  * shared: delete model-provider-family.ts (zai/bigmodel family 目录、OAuthProviderId、
  * shared: 删除协议账号契约（zcodeAccountAccessSchema / zcodeProviderAccountAccessSchema）
  * shared: zcodeEndpoint 按 keep-list 收口——删除 ZAI OAuth/bigmodel builder、
  * shared: AppSettings 删除 startPlanRecommendationDismissed（zod strip 兼容旧配置）
  * cli: 删除零调用方的 cli-oauth.ts / bigmodel-oauth.ts / coding-plan-api-key.ts；
  * services: 删除 accountRequestAuthService（自 P2 起仅剩恒失败空实现）与孤儿
  * ui: 设置页 de-plan——删除套餐状态卡/Start Plan 卡/连接方式导航/entitlement 过渡
  * ui: 模型菜单/切换文案/list-models 分组改为中性按 provider 名称聚合；
  * provider-node: ModelSelectionFacade 分类器恒为 ordinary；provider rule-data-schema

* replace remote builtin-provider catalog download with bundled-only source (P3 C5) ([acd8488](https://github.com/yeyuan98/ZCode/commit/acd8488e006bd9889f3f3117d18099d3e726519d))
  * provider-node: delete zcode-builtin-download (client/configs → builtin_provider_config_json → CDN), zcode-builtin-remote-synchronizer (TTL/lease refresh control), endpoint-scoped-zcode-builtin-source, zcode-builtin-cache-paths; NodeProviderConfigRuntime reads the bundled config only (offline-capable), refreshZCodeBuiltin becomes a local source re-read, applyRemoteRelease dies with the remote write path
  * services: drop zcodeBuiltinEnvironment/fetchZCodeBuiltinRemoteRelease wiring in node.ts + providerConfigRuntime options; delete zcodeBuiltinRemoteConfig.ts and runtime-tools/clientPlatform.ts (platform segment only served vendor catalog requests)
  * cli: process-provider-registry-runtime drops the remote download wiring + refresh reporter; prepareCliProviderRuntimeEnv points ZCODE_BUILTIN_PROVIDER_CONFIG_FILE straight at the bundled file (no endpoint-scoped active cache); ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE_ENV removed (last reader died)

* **shared,desktop,services:** off-peak local admission window + settings + Run-now plumbing (P3 S1) ([2f4a8c9](https://github.com/yeyuan98/ZCode/commit/2f4a8c9adb40473b09b2a116a69c01a438f6c2e9))
  * shared/off-peak-window.ts: withinWindow/msUntilWindowOpen 纯函数（跨午夜回绕、[start,end) 边界钉死）与 offPeakWindow zod schema
  * AppSettings 新增 offPeakWindow {enabled,start,end}（默认 00:00-07:00）：zod、protocol transport、patch schema
  * schedulerProtocol: 新增 correlated offpeak-admission-request/response 与 offpeak-run-now 消息
  * scheduler runtime 端口注入 seam 重构（index.ts 仅 Electron 装配；cron/offPeak controller 拆分），每 tick 认领前先询问 main 准入，超时 fail-closed
  * repo 新增 claimOneForRunNow（status='queued' AND claim_running=0 原子认领）；OffPeakTaskService.runNow（paused 先回 queued）
  * desktop main 是 settings 唯一属主：resolveOffPeakAdmission + window-open 定时器唤醒 scheduler；Run-now host→main→scheduler 转发链

* **shared,ui:** unpin image-search from default-enabled official plugins (P3 C3, ruling 5) ([9e98de7](https://github.com/yeyuan98/ZCode/commit/9e98de7d19470928094825b2ff50b517ec557cd5))
  * image-search 的 MCP 后端是官方 Server MCP，已随 C3 主体删除，默认启用只会带来
  * 移除 UI 内置图标映射与打包资源 image-search.png；插件 definition 与市场条目

* **ui,i18n:** off-peak window settings UI + Run-now action + auto-decline copy (P3 S1) ([ce20396](https://github.com/yeyuan98/ZCode/commit/ce20396aadd2e962c2f970b25444a9415a48937b))
  * Automations idle tab 新增时间窗设置条（enabled + start/end 本地时钟输入，写共享 settings offPeakWindow；属主在 desktop main）
  * 闲时卡片菜单新增「立即运行」（queued/paused；scheduler 端 claim 原子 no-op）；TID_OFFPEAK_ACTION_RUN_NOW/TID_OFFPEAK_WINDOW_* test-ids
  * 创建资格本地化：无灰度/套餐/额度门，= Registry 存在可选模型（fail-closed）；远程 workspace 提示不可用
  * OffPeakCreate 轮尾卡删除位次快照
  * i18n（双语 89→81 键）：删除票据/额度/codingPlanOnly/newTask-banner/位次键；新增 window-setting + runNow 键；permissionWarning/空态/操作提示改为本地时间窗与自动拒绝语义

* **web:** remove web OAuth auth dir + share landing owner-login (P3 C1) ([7590490](https://github.com/yeyuan98/ZCode/commit/7590490874a3e93a6cede0345dfb39e541fe79d8))
  * 删除 packages/web/src/auth/**（7 文件）：WebCallbackPage、webAuthService、
  * main.tsx：移除 /cn/share/callback OAuth 回调路由渲染与分享页 owner 登录
  * ConversationShareLandingPage：移除 WebOAuthProviderId 类型、双 provider
  * vite.config.ts：移除 VITE_ZAI_OAUTH_* define 注入与 /api/v1/oauth/token


### Bug Fixes

* **p3:** review round fixes — stale model-facing copy, comment rot, dead i18n keys, spec amendments ([e92848b](https://github.com/yeyuan98/ZCode/commit/e92848bad81d80701b3293cae93c6c391747e4d4))
  * OffPeakCreate tool metadata rewritten for local semantics (own provider, idle window, build default, auto-decline noted); vendor ticket/quota language removed
  * /login & /logout slash-help entries deleted (documented commands deleted in P1; pulled forward from P4 as dead help text)
  * run-now channel comments reworded in node.ts/validation.ts/channels.ts; provider-runtime-headers stale account comment fixed; provider-selection-v2 gets P3 tombstone note
  * i18n: drop offPeak.sectionTitle + offPeak.form.keepAwakeHint (zero consumers; thought.*/tabs.* verified as live dynamic keys and kept); stale login.expired comments updated
  * specs/off-peak-local-admission.md: blocked-outcome wording matches implementation (standard outcomes, no separate status); ModelRequestAuth deferral recorded


### Chores

* dynamic-workflow + help-config comment refresh after C5 vendor config-fetch removal (P3 C5) ([ddb35c2](https://github.com/yeyuan98/ZCode/commit/ddb35c271d483cd14b2f8485c36cd25cc6504692))
  * CLI dynamic-workflow-policy: gate reads host-pushed local state only (no vendor fetch since C2); stale /client/configs comment corrected
  * shared dynamic-workflow-feature: header documents local-only resolution (env override > default disabled, A9 local constant OFF)
  * helpAppConfig: cross-reference now records all client/configs consumers dead except the P5 force-update gate
  * residue sweep clean: zero live client/configs / builtin_provider_config_json / clientConfigService / desktopContextPromptRollout / zcodeBuiltinRemoteConfig references outside P5 updater path and P3-deletion comments; dist/ artifacts regenerate on build

* **i18n:** drop dead vendor usage keys (P3 S2) ([5719fba](https://github.com/yeyuan98/ZCode/commit/5719fba27eec651f77c51b855a8ca1ff28f5ec9b))
  * 删除 en-US/zh-CN 各 200 个无消费方的用量键（逐键 grep 消费方后删除，动态模板键保留）：
  * 模板字面量消费的 settings.usage.range.* 与 heatmap.range.* 保留；

* knip sweep — drop 12 newly-orphaned exports (P3 review leftovers) ([63a0fff](https://github.com/yeyuan98/ZCode/commit/63a0fffb05aa13e30a3d3eef10635dec67cfa937))
  * 类型收窄为模块内（不再 export）：desktop scheduler 的 CronSchedulerControllerDeps / OffPeakSchedulerControllerDeps / SchedulerPortShape / SchedulerRuntimeHandle / SchedulerRuntimeDeps（测试经 ReturnType<typeof createSchedulerRuntime> 推导，无需导出 handle/deps 类型）、services OffPeakInteractionPolicy、desktopDeepLinkUrl isOAuthCallbackUrl（模块内消费）、ui resolveModelProviderNavLogo / SegmentPill / formatAppUsageDuration
  * 删除零消费者：ui setPendingSettingsUsageIntent（Usage 入口改为直接 setPendingSettingsSection("usage") 后遗留）
  * AlertDialogRequest 保持导出并在 useAlertDialog 显式引用（导出函数签名需要可命名的返回类型，同时构成真实跨模块消费）

* **p3:** S4 sweep — remove dead account:* logo registry entries, start-plan asset + orphaned test-ids ([90970f0](https://github.com/yeyuan98/ZCode/commit/90970f043b1b4bc8bde9981bc47eca07cb2cde1c))
  * logo-sources.json: drop Start Plan entry and account:* providerIds (dead since P1); map zai/bigmodel standard template ids to their family logos (equal-vendor icon coverage)
  * ProviderLogo: remove start-plan asset key (no config references it); delete the png
  * test-ids: remove start-plan and connection-mode TIDs (UI deleted in C4, zero consumers)

* **shared:** fix stale forceUpdate comment after C2 purge (P3 C2) ([6032aed](https://github.com/yeyuan98/ZCode/commit/6032aed5c0a612f00f38e0c0cd291e939accef74))

* **ui:** drop newly-orphaned codingPlanPurchaseAuth (P3 C2) ([f94c946](https://github.com/yeyuan98/ZCode/commit/f94c946fd77ac319f5b67d8801f4890807134a63))


### Documentation

* **p3:** S5 — flip spec status, record P3 delivered state + effort in master plan ([2e42944](https://github.com/yeyuan98/ZCode/commit/2e4294442aa12838561441b16e495999922958e3))
  * specs: Status → implemented-by P3 (alpha.7)
  * VENDOR-PURGE-PLAN.md: §4 P3 delivered-state prose, §1 status → next P4, §7 effort refresh
  * handoff (ZCode-handoff.md, outside repo) rewritten separately

* **p3:** specs + amendments for services purge & off-peak local admission ([02e8f0e](https://github.com/yeyuan98/ZCode/commit/02e8f0e04aa44d0dd1ca9b585cdfb8d356aa47fa))
  * add specs/off-peak-local-admission.md: window-only admission (ruling 1) + Run-now, hands-off interaction policy with rationale (ruling 2), owners/event order, settings schema, ticket-column hard-cut, test scenarios, expected-death list
  * add specs/account-services-purge.md: C1-C5 domain commits, dormant user framework design (ruling 6), invariants/keep-traps, migration boundary
  * record amendments A6-A14 (P3) in VENDOR-PURGE-PLAN.md §4 P3

* **plan:** record P1.2 merge/release hashes ([d89e4ca](https://github.com/yeyuan98/ZCode/commit/d89e4ca6629ff3702cf7128dd381b832c498c520))


### Refactorings

* **p3:** S0 free deletions + ForceUpdateConfig inline ([b670e6c](https://github.com/yeyuan98/ZCode/commit/b670e6c46e0383a824cfe43b2c7d5c8879168eda))
  * delete shared plan-identity.ts / provider-family-connection-selection.ts / account-provider-state.ts (verified zero importers; barrel re-exports and package.json subpath removed with them)
  * delete dead provider/updateAccountConfig wire: params/result schemas + method id (zero handlers repo-wide)
  * delete resolveRuntimeProductEndpointConfig + RuntimeProductEndpointConfig (zero importers)
  * inline ForceUpdateConfig into forceUpdate.ts ahead of the coding-plan-subscription.ts deletion in C2 (gate itself is disposed of in P5)

* **services,shared:** purge vendor usage quota surface (P3 S2) ([6c72801](https://github.com/yeyuan98/ZCode/commit/6c728012c19d638817f5f5fb0d90cdfb74802015))
  * 删除 shared/src/usage-stats.ts（vendor 半边：UsageStatsRequest/Snapshot、CodingPlanUsage*、UsageEntitlement*、PlanIdentity*、monitor 聚合类型）与 usage-quota.ts 全部额度类型；barrel 只保留 app-usage.ts
  * IUsageStatsService 仅保留 getAppUsageSnapshot；删除 getCodingPlanUsageSnapshot、getCodingPlanReset*、markCodingPlanResetHistoryRead、getSnapshot(monitor)、getEntitlementSnapshot
  * usageStatsService 甩掉全部三个跨 slice import（isCodingPlanModelProviderId / IAccountRequestAuthService / OfficialMcpCredentialSource），只依赖 zcodeAgentService
  * 删除 7 个 vendor provider：bigmodelUsageQuotaProvider/MonitorMapper/MonitorRange/QuotaMapper、bigmodelSubscriptionProvider、zcodeMcpQuotaProvider（providers/ 目录清空）
  * node.ts：usage 注册仅注入 zcodeAgentService；officialMcpCredentialSource 常量与 resolveOfficialMcpCredentials 导入随额度查询面删除（MCP 身份头 resolver 保留，属 C3）
  * desktop remoteWorkspaceServiceCollection：usage 注册同步精简；localAccountRequestAuthService/OAuthCredentialRepo/accountProviderCredentialService 等 vendor 查询链随之移除
  * UI 过渡：新增 lib/usageQuotaShapes.ts（C4 de-plan 时移除），model-provider-section 存活文件与 codingPlanProvider/codingPlanQuotaPresentation/codingPlanOwnedEntryPlans 的 entitlement/quota 类型改从过渡模块导入

* **shared,services,desktop,ui,cli:** rebuild off-peak as local window-admission feature (P3 S1) ([8c5b8a6](https://github.com/yeyuan98/ZCode/commit/8c5b8a6fb5c055bee9feebe2cc210357cfdb4e6e))
  * off_peak_tasks 删除 6 个供应商票据列（server_ticket_id/registered_at/schedulable/queue_position/next_poll_at/settled_at），索引 0 变更
  * repo 行映射/create/markRunning/markTerminal/invalidateModelSelection/claimDue 同步裁剪；claimDue = status='queued' AND claim_running=0（认领前由 scheduler→main 时间窗准入）
  * 删除 updateSchedulingSnapshot/markSettled/listUnsettledTerminal/requeueForContinuation（票据快照/核销 outbox/3102 续跑语义）
  * offPeakTaskService 重写：创建即落库（无取号/额度/灰度门），资格=存在可解析的模型选择；删除 offPeakTaskSync 轮询与 settle outbox；保留重启恢复语义
  * 删除 offPeakServerClient/offPeakMockGateway/offPeakModelSelectionView；offPeakRuntimeModel 只保留确定性错误类型
  * zcode-protocol off-peak create/snapshot 删票据字段与 3101/3103 分类；modelExecutionSchema 删除 requestAuth 字段
  * host dispatchOffPeakRun 删 requestAuth 注入与无票 guard；执行用任务持久化 Selection
  * 闲时免打扰（binding policy）：off-peak turn 为会话活跃 turn 期间（host 派发注册表，终态/订阅释放摘除），permission/AskUserQuestion/plan-approval 在 agent service 层自动拒绝；普通 turn 不受影响
  * OffPeakCreate 工具缺省权限档 yolo→build
  * 删除 offpeak-retry.ts（429 排队豁免/3102 标记）；runner-generate/runner-stream offPeak 分支与 ticket 头脱敏删除
  * bootstrap model-execution 删 requestAuth freeze；requestDependencies/ModelRequestAuthSource 注入链删除（ModelRequestAuth 保留给账号 runtime headers 刷新路径）
  * contracts off-peak 工具/端口删票据字段与额度/资格分类
  * providerBusinessError 3102 分支、ChatErrorBanner 标记兜底、offPeakTaskStore quota_3103/灰度/额度面删除
  * 'account-offpeak' Provider 身份类删除（effective-model-selection/model-selection-facade）

* **shared:** rehome AppUsage schemas to app-usage.ts (P3 S2) ([6a69485](https://github.com/yeyuan98/ZCode/commit/6a694859ecfa3964b7c52517f7309a68d1abb7c5))
  * 新增 packages/shared/src/app-usage.ts：ESTIMATED_TOKEN_CHAR_DIVISOR、APP_USAGE_RANGES、全部 appUsage*Schema 与 AppUsage* 类型、AppUsageRequest（P3 供应商套餐/配额面删除的通用半边迁移）
  * usage-stats.ts 顶部 re-export app-usage.js，删除文件内重复定义；协议 import 暂不切换行为
  * zcode-protocol/index.ts 与 zcode-protocol-v4/transport.ts 的 usage stats 方法 schema 改从 ../app-usage.js 导入（方法本身保留，AppUsage-only）
  * shared barrel 增加 app-usage 导出

* **ui:** delete vendor plan/quota usage UI cluster (P3 S2) ([dd430a2](https://github.com/yeyuan98/ZCode/commit/dd430a2c86219d5ea84cf81c9622ecd0d63256ea))
  * 删除 Coding Plan 用量面板族：CodingPlanUsagePanel/BarChart/LineChart、codingPlanUsageChartSeries、codingPlanUsageSources、来源偏好 sidebarUsageCodingPlanProviderPreference
  * 删除 entitlement UI 链：hooks/useUsageEntitlement、usageEntitlementCache、usageEntitlementRefreshPolicy、CodingPlanUsageRemainingPanel、WorkspaceSidebarFooterUsageSummary(+PlanBadgeHelpers)、footer 用量摘要/套餐徽标/升级入口接线
  * 删除额度重置簇：components/coding-plan-quota-reset/*（5 文件）、codingPlanQuotaResetUi/Coordinator/Confetti、useCodingPlanQuotaResetUi、store/codingPlanQuotaResetState（含 store 字段与跨窗口广播）、chat-input-toolbar 重置自动播放/机会提醒/徽标、contextQuotaMeterGrid、contextPanelAction（孤儿）
  * 删除 v4 会话额度横幅族：useV4SessionQuotaBanner、ConversationQuotaBanner、sessionQuotaBannerState/DismissalStore、startPlanQuotaBuckets/ReminderStore；SessionPane 移除 quotaBanner/handleOpenModelUpgrade/mcpUnavailableNotice 接线
  * 删除 Start Plan 推荐改选：useStartPlanRecommendation、startPlanRecommendation、startPlanEntitlementOptions、selectionSideInheritedModel（孤儿），SessionPane/AutomationEditView/SubagentsSection 调用点改为直接使用当前选择
  * contextUsage.tsx 收敛为 context-only（仅 Context windows 统计），V4ComposerToolbar 移除 entitlement/余额/升级组装
  * SettingsPage Usage 分区改单一 App Usage 面板；settingsNavigation 移除 usageTab 意图管道；ChatErrorBanner/ConversationComposer 移除升级入口
  * providerBusinessError 移除额度横幅专用业务码解析；useCodingPlanEntitlements 退化为空权益 stub（C4 de-plan 时移除）；StatusCards 剥离额度重置 UI；CodingPlanEntryButton gate 退化为恒 ready
  * useUsageStats 仅保留 useAppUsageStats（agent 数据库统计）


### Other Changes

* feat! remove coding-plan subscription service + shared purchase protocol + UI cluster (P3 C2) ([e41f6a3](https://github.com/yeyuan98/ZCode/commit/e41f6a3bd8a49559f3edc3c70bc0a5b2d288e4b6))
  * services: 删除 coding-plan-subscription/**（4 文件，购买/企业订单/静态目录/
  * node.ts: 账号请求鉴权改内联空 resolver（Registry 自 P2 不发布账号 Access，
  * accountRequestAuthService.ts: AccountRequestAuth* 类型与
  * wiring: accessor / services index / client remoteServiceAccess /
  * shared: 删除 coding-plan-subscription.ts（519L 购买/企业订单协议类型；
  * ui: 删除购买入口链（CodingPlanEmbeddedWebviewDialog + codingPlanEmbeddedWebview +

* feat! remove vendor OAuth services + adopt dormant user framework (P3 C1) ([37e9545](https://github.com/yeyuan98/ZCode/commit/37e9545cb1caaa700a1f41c3556196bedd94d6b2))
  * 删除 packages/services/src/oauth/**（16 文件，含 providers/ 与 repo/oauthCredentialRepo.ts）；
  * node.ts：移除 apiClient 401 分类钩子、corrupt-session 登出广播、onboarding loadUserId
  * shared：新增 user.ts（UserInfo 迁入，ruling 6）与 credential.ts（通用凭据解密错误码迁入）；
  * channels/platform：删除 ServiceChannels.OAuth 与 OAuthRegisterState/OAuthCallback/
  * providerProvisioningSource/Target：OAuth 凭据键 allowlist 清空，同步机制保留。
  * desktopOAuthDeepLink.ts 拆分为通用 desktopDeepLink.ts（workspace/支付/分享导入路由、
  * appLaunchCoordinator 简化为 ready 即消费启动 gate（OAuth 回调等待删除）。
  * remoteWorkspaceServiceCollection 移除 OAuth 服务重实例化与登出 handler。
  * desktopRuntimeEnv/tsup/.env.example/server connect.ts 裁剪 ZAI_OAUTH_* 注入
  * 删除 useRootOAuthEffects、oauthCachedSessionRestore、oauthLoginAttemptGuard、
  * store 删除 OAuth 会话字段簇（isRestoringOAuthSession/oauthError/oauthPollingActive/
  * WorkspaceSidebarFooter 移除头像/用户块与登录/退出菜单，偏好菜单改中性触发器；
  * ModelProviderSection 仅摘除 OAuth 同步回调块；rootStartupGate 去掉启动 auth 恢复门禁。
  * i18n：删除 login.oauth.*/login.expired.*/logout.*/sidebar.profile.*/app.login/

## [3.14.3-alpha.6](https://github.com/yeyuan98/ZCode/compare/v3.14.3-alpha.5...v3.14.3-alpha.6) (2026-09-27)

### Bug Fixes

* **catalog:** GLM vision over-application on anthropic endpoints (P1.2) ([50ee7e4](https://github.com/yeyuan98/ZCode/commit/50ee7e4dc8cb1cbad4cbaa82c4dc1a4dd76d236e))
  * delete the two upstream vendor anthropic inputFormat site rules (api.z.ai + open.bigmodel.cn /api/anthropic, modelMatch .*): they expressed 'endpoint accepts image/video blocks' but overlay after modelRules (later-defined wins) and blanket-overrode every per-model image:false — all glm models showed vision on anthropic-flavor providers; latent upstream bug surfaced by the P1.1 rule restore; openai-compat flavor (no site rules) was already correct; midConversationSystem endpoint rules kept
  * extend the flash-family vision overlay in place to (?:x)?: glm-5.3-flashx (suffix letter, no separator) previously missed by the overlay and masked by the site blanket — now vision per user ruling, ctx 1M via family base rule; cross-flavor intended flip pinned in tests
  * resolver regression tests on both flavors: glm-5.3 image FALSE + ctx 1M; flash + flashx vision (video/pdf); glm-4.6v vision; unrated models default non-vision (no endpoint blanket)
  * catalog-level guard: no vendor anthropic site rule may carry inputFormat again
  * spec: P1.2 clauses + catalog-source note (upstream v3.14.3 vendor catalog rev 30, fork-maintained); master plan: P1.2 section, matrix row A6, alphas re-shifted (P3=alpha.7 … P6=alpha.10); revision stays 30


### Documentation

* **plan:** mark P1.1 delivered (v3.14.3-alpha.5) ([39a7878](https://github.com/yeyuan98/ZCode/commit/39a7878505f65280036932f5d4f49f7bbe8a60ed))


### Other Changes

* docs+test(p1.2): review fixes — full-lineup sweep test, plan re-shift corrections ([4cf9032](https://github.com/yeyuan98/ZCode/commit/4cf9032ca884dbf32b659350ba10f4d53522e4e3))
  * committed full 11-model bigmodel lineup sweep (vision only for flash/flashx; ctx tiers 131072/200000/1M) — hardens against future catalog drift (reviewer's throwaway sweep verified current values)
  * master plan: P1.1 version-note range re-worded (alpha.6 re-taken by P1.2); runbook A1..A10

## [3.14.3-alpha.5](https://github.com/yeyuan98/ZCode/compare/v3.14.3-alpha.4...v3.14.3-alpha.5) (2026-09-27)

### Features

* **catalog:** restore GLM capability metadata rules (P1.1 F1, decision A5) ([3696988](https://github.com/yeyuan98/ZCode/commit/369698897495dc78211252441425022e23b36cb3))
  * re-add the 24 pre-P1 GLM capability modelRules verbatim from 0ed9c86, original array order preserved (overlay order is load-bearing); the P1-sanitized composite ox-alpha|x-preview-f-free rule is superseded by the verbatim ox-alpha|glm-x-preview-f|x-preview-f-free form (same rule, glm alternative restored) — 84 rules total, matching pre-P1 sequence
  * probe evidence: bigmodel/zai listing endpoints return ids only on both api flavors, so curated capability rules are the only correct-config source for GLM models; 61 equivalent rules for other vendors survived P1 — without the restore, GLM is the only metadata-less major family (violates equal-vendor treatment: glm-5.3 resolved 200k/no-vision instead of 1M; glm-5.3-flash lost vision/video/pdf)
  * catalog invariant refined (A5): glm allowed only inside modelRules modelMatch + capability props; templateModelRules/builtinProviderModelRules stay glm-free (test: parse→null modelMatch→assert; + glm-free subtree asserts; count lock 84)
  * new builtinGlmCapabilityRules.test.ts: glm-5.3→ctx 1M; glm-5.3-flash→image+video+pdf overlay; uppercase GLM-5.3 matches; glm-4v-flash→16384+image
  * master plan: A5 recorded (user sanction quoted; rejected alternative noted), §1 goal 5/§3 row/§4 P1 summary/P6 allowlist annotated, P1.1 section added, alphas re-shifted (P3→alpha.6 … P6→alpha.9) incl. two pre-existing stale refs fixed

* **discovery:** parser hardening + optional capability hints (P1.1 F4) ([33c70fb](https://github.com/yeyuan98/ZCode/commit/33c70fb850665a7ff4feb7cba3ee8936bb71f75a))
  * accept both snake_case has_more/first_id/last_id (Anthropic spec) and camelCase hasMore/firstId/lastId (bigmodel/zai legacy mirrors, live-probe-verified); snake_case takes precedence
  * repeated-first-id loop guard: a mirror that ignores after_id and restarts from page 1 stops paging immediately (treat as complete); 10-page cap retained as backstop
  * additive success-result field modelHints: anthropic max_input_tokens(>0)→contextWindow + capabilities.image_input/pdf_input.supported; openai-compat context_length(>0) + architecture.input_modalities ∩ {image,video} (audio/file ignored; 0/null absent); cross-page merge fills absent fields only, never overwrites; keys omitted when no metadata (deepEqual-stable)
  * +7 unit tests: camelCase mirror, snake-precedence, ignored-cursor guard (≤2 requests), anthropic metadata, max_input_tokens:0, openrouter shape, cross-page merge both directions

* **settings:** per-provider Discover models action + bulk merge (P1.1 F3) ([27a6d8d](https://github.com/yeyuan98/ZCode/commit/27a6d8df2307546ee142a33d34d0adaf4442c31f))
  * facade discoverProviderModels(providerId): reads the provider's own config server-side (key never crosses the RPC surface nor appears in error text — asserted by test); keyless providers discover anonymously; delegates to the shared direct-endpoint core
  * ProviderConfigService.addPersonalModels: single-transaction bulk merge; dedupes silently against personal + builtin inherited ids and in-batch repeats; returns added count; hints gap-filling extracted as applyInitialModelHints and shared with createPersonalProvider (identical semantics)
  * UI: Discover models button in ProviderModelsSection next to add-model (existing feedback banner pattern; spinner while testing); useDiscoverProviderModels hook; i18n discoverModels/discoverModelsSuccess {count}/discoverModelsFail in both locales
  * 5 facade/provider unit tests: dedupe vs personal+builtin, 401 error excludes key while request carries it, keyless flow, unknown-provider/no-baseUrl errors, create-vs-bulk hints equivalence (glm-5.3 → no manual rule when catalog covers)

* **wizard:** auto-discover on save + hints-aware initialModels persistence (P1.1 F2) ([814feb8](https://github.com/yeyuan98/ZCode/commit/814feb88f7c22157f3317edca850b6a35e7db023))
  * save handler calls discoverTemplateModels directly (never stale hook state) when discovery state is idle and the template has an api config; silent; failure saves zero models (documented escapes); success/failure states never re-run
  * custom-provider path auto-discovers via new facade discoverCustomProviderModels → discoverModelsForEndpoint (direct-endpoint discovery wrapper)
  * CreatePersonalProviderInput.initialModelIds → initialModels: (string | {id, hints?})[]; InitialModelHints declared structurally in provider (no cross-package import); hints fill only fields the catalog leaves empty EXCLUDING the .* catch-all fallback (catch-all is the unknown-model default, not catalog knowledge — otherwise hints would be dead code); applied hints persist as complete manual rules (manual schema requires all leaves; creation-time effective values frozen for non-hint leaves — accepted shadow boundary, documented)
  * keyless (ollama) path included; hook state extended with modelHints
  * unit tests: hints fill-vs-override matrix through real createPersonalProvider→resolver (catalog-provided → no manual rule; explicit catalog false beats hint true; string entries; dedupe); discoverModelsForEndpoint URL normalization; e2e: save-without-button scenario locks auto-discover
  * e2e mock template no longer injects builtinModelIds: gate-closed-after-reload assertions now prove discovery persistence (both manual + auto paths) instead of passing via hardcoded ids


### Bug Fixes

* **p1.1:** apply ulw review fixes (shadow-scope spec, testing-race, e2e locks) ([6f6e488](https://github.com/yeyuan98/ZCode/commit/6f6e4884f103bbf9b25c05fca2ff085b91e9e9be))
  * spec §2 corrected to the implemented shadow semantics: applying ANY hint persists a complete manual rule (manual schema requires all leaves) — the model then shadows future catalog changes for ALL manual leaves until user-edited/removed (was wrongly promising per-field shadowing); two-phase catalog regression test locks frozen-value-wins (500k frozen vs 999k later catalog rule)
  * spec §3: Continue disabled while a discovery run is in flight (was: mid-testing save fell through to zero-model); custom-form wording clarified (requires key; keyless goes via ollama template); ollama step wording aligned with implementation (key-less variant, not skip)
  * wizard: Continue button disabled during discovery testing state
  * e2e: custom-provider scenario gains the reload gate-closure assertion (auto-discover persistence locked on both paths)
  * unit: anthropic mirror has_more-without-last_id stops paging after one request
  * knip: unexport in-file-only ProviderModelDiscoveryState type


### Documentation

* **spec:** P1.1 amendments — A5 capability-metadata invariant, auto-discover on save, hint merge rule ([2a8cd75](https://github.com/yeyuan98/ZCode/commit/2a8cd7539676ec794b48435095b224fae9291f84))
  * catalog invariant refined: glm allowed only inside modelConfigRules.modelRules (modelMatch + capability props); templateModelRules/builtinProviderModelRules stay glm-free (decision A5: equal-vendor capability metadata, 61-rule precedent)
  * discovery §2: legacy camelCase hasMore mirrors (bigmodel/zai) + repeated-first-id loop guard; optional capability hints (anthropic max_input_tokens/capabilities, openai-compat context_length/input_modalities) with catalog-wins precedence
  * wizard §3: save auto-discovers when idle (template/custom/keyless paths); failed discovery not re-run; custom-path expected-death bullet amended
  * acceptance scenarios extended (resolver glm metadata, hint precedence both directions, auto-discover e2e, per-provider discover unit)

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
