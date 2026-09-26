# libre-zcode Vendor Purge — Master Plan

- **Repo:** `/home/administrator/git/ZCode` (fork of ZCode v3.14.3, branch base `main`)
- **Goal:** Remove all Z.ai / Zhipu / BigModel vendor-specific code — platform backend, logins, accounts/plans/subscriptions, vendor-bound skills/tools, vendor CDN/telemetry/infra — while keeping the product fully usable via generic API-key providers and local models. zai/bigmodel remain available as **ordinary, equal vendors**.
- **Version policy:** stay upstream-consistent at **3.14.3**; per-phase test releases as `3.14.3-alpha.N`; final release is exactly `3.14.3`.
- **Status:** EXECUTING. P0 done (`v3.14.3-alpha.1`); P2 done (`v3.14.3-alpha.2`, 2026-09-26) + wizard UX hotfix (`v3.14.3-alpha.3`); next: P1 (ships as alpha.4). Investigation: 4 parallel deep-dive subagents + 3 independent review rounds, all findings source-verified on `main`.
- **Fresh-start policy:** no migration/compat shims for old setups; there are no existing libre-zcode users.

---

## 1. Goals and non-goals

### Goals

1. No dependency on any Z.ai-operated service (`zcode.z.ai`, `chat.z.ai`, `api.z.ai` platform APIs, `open.bigmodel.cn` account APIs, `cdn-zcode.z.ai`).
2. No vendor accounts: OAuth login, coding-plan/start-plan/off-peak-**server** entitlements, in-app purchase, quota/billing panels — all removed.
3. No vendor telemetry: ARMS RUM and 数仓 event reporting removed; OpenTelemetry (OTLP) is the only, env-gated, opt-in telemetry.
4. No vendor-bound tools/skills: vendor-hosted MCP, provider-native WebSearch tool removed; off-peak kept but re-architected as vendor-agnostic local execution.
5. No GLM-specific model-id rules in the catalog; model lists auto-discovered via standard provider listing routes.
6. Neutral identity: `glm` agent-provider id renamed to `zcode`; vendor branding/links/themes/service names neutralized.
7. Self-owned distribution: updates via GitHub Releases (electron-updater GitHub provider), remote assets via GitHub Releases with env-overridable mirrors.
8. Every phase independently vetted: unit/integration tests + manual testing of a fresh alpha install.

### Non-goals (explicitly kept)

- zai/bigmodel as ordinary providers: their 4 API templates stay in the catalog with plain `api-key` access, equal to kimi/deepseek/openai/anthropic/etc.
- Third-party IM bots (WeChat / Feishu / Telegram / generic webhook) — user-configured, not Z.ai.
- Self-hosted `packages/server` + `packages/web` (self-issued token auth, no vendor auth).
- GLM-behavior compat guards keyed to endpoint behavior (not vendor identity) in compact/workflow/repl paths — kept as generic robustness; comments neutralized.
- ai-sdk patches (anthropic video block, openai-compatible `video_url`) — generic media support.
- CLI/agent-internal version schemes (e.g. agent runtime `0.13.3`) — untouched by the 3.14.3 app-version policy.

---

## 2. Vendor coupling inventory (verified findings)

### 2.1 Endpoint registry (single source)

`packages/shared/src/zcodeEndpoint.ts:3-7`:

- `DEFAULT_ZCODE_ENDPOINT_ORIGIN = "https://zcode.z.ai"` (platform backend)
- `DEFAULT_BIGMODEL_API_ORIGIN = "https://bigmodel.cn"`
- `DEFAULT_ZAI_OAUTH_ORIGIN = "https://chat.z.ai"`
- `DEFAULT_ZAI_BUSINESS_BASE_URL = "https://api.z.ai"`
- `DEFAULT_ZAI_OAUTH_CLIENT_ID = "client_P8X5CMWmlaRO9gyO-KSqtg"` (public client id, documented non-secret)
- Derived: `/api/v1/zcode-plan*` (billing), `/api/v1/oauth/*` (token broker), `/api/v1/client/configs`, `/api/v1/mcp/usage`, `/api/v1/off-peak`, `/api/v1/releases/electron/manifest` (update feed), web share callback.
- Env overrides exist (`ZCODE_BASE_URL`, `ZAI_*`, `BIGMODEL_*` — `.env.example`).

### 2.2 Provider catalog (`config/provider/zcode-builtin.json`, rev 30)

- 4 vendor templates: `zai-api` / `bigmodel-api` (anthropic-compatible, access `zhipu-coding-plan-api-key`) + `zai-standard-api` / `bigmodel-standard-api` (openai-compatible, plain api-key).
- 8 vendor account providers `account:zai-*/account:bigmodel-*` (individual/team coding-plan, start-plan, offpeak-idle) — all `access.type = "zhipu-account"`.
- GLM-id-keyed rules: 24 modelRules + templateModelRules + builtinProviderModelRules.
- 16 other generic templates (moonshot-kimi, minimax, deepseek, qwen ×2, xiaomi-mimo, openai, anthropic, xai, openrouter, opencode-go ×3, opencode-zen ×3, and after our change + ollama).
- `supportsNativeWebSearch` capability rules keyed to vendor baseUrls.

### 2.3 Vendor schemas/types (fan-out)

- `packages/shared/src/providers.ts:10` — `ZCODE_PROVIDERS = ["glm"]` (agent provider enum).
- `packages/shared/src/zcode-agent-policy.ts:5` — `ZCODE_AGENT_PROVIDER = "glm"` (~171+ TS refs / ~65 files total for `\bglm\b`).
- `packages/shared/src/zcode-protocol/index.ts:812-850` — `zhipu-account` access schemas; also `provider-family-connection-selection.ts`, `usage-quota.ts`, `usage-stats.ts`, `plan-identity.ts`, `coding-plan-subscription.ts`.
- `packages/provider/src/config/provider-data-schema.ts:32,43` — zod literals `zhipu-account` / `zhipu-coding-plan-api-key`; class `ZhipuAccountAccessConfig` in `provider-config.ts`; account overlay in `account-provider-resolution.ts`, `accountProviderConnectionResolver.ts`.
- `packages/shared/src/model-provider-family.ts` — z.ai/bigmodel family roots + manage URLs; `model-provider-types.ts` vendor ids; `off-peak-types.ts:41-44` `OFF_PEAK_PROVIDER_IDS`.
- `providerFamilyDomain` AppSettings field (`"zai"|"bigmodel"`) — 137 refs/~30 files; consumed by startup gate `useProviderAvailabilityLoginEntryGuard.ts:57` (`shouldOpenLoginEntry = !providerFamilyDomain || (!user && !hasUsableProvider)`).

### 2.4 Services (vendor middle-tier)

- OAuth: `packages/services/src/oauth/**` (zai/bigmodel adapters+configs, oauthService device-flow via `{ZCODE}/api/v1/oauth/cli/*`, token exchange `{ZCODE}/api/v1/oauth/token`), `packages/web/src/auth/**` (browser OAuth, plaintext localStorage tokens).
- Billing/subscription: `packages/services/src/coding-plan-subscription/**` (Alipay/Stripe/PayPal/enterprise; `/api/biz`, `/api/pay`, `/api/v1/client/configs`), `zaiCodingPlanSubscriptionProvider.ts`.
- Quota/usage: `packages/services/src/usage-stats/**` (bigmodelUsageQuotaProvider, zcodeMcpQuotaProvider), `zaiStartPlanBilling.ts`, `codingPlanProviderAvailability.ts` (558 lines), `teamPlanApiKey.ts`, `services/src/bigmodel/codingPlanEntitlement.ts`, `model-provider/accountProviderApiClient|ApiTypes|RequestAuthService|TeamPlanRequestKey.ts`, `bigmodelStartPlanZcodeJwt.ts`, `setting/legacyAccountConnectionSettings.ts`.
- Off-peak (vendor-server execution): `offPeakServerClient.ts` (`{ZCODE}/api/v1/off-peak` + ticket admission), `offPeakRuntimeModel.ts` (JWT + plan-key headers), mock gateway; ticket-bound schema columns (`server_ticket_id`, `queue_position`, …) in `tasksDatabase/schema-v1.ts:148-180`.
- Official MCP: `packages/shared/src/official-mcp-auth.ts` (`zcode_official` auth, Bigmodel identity headers, origin trust = zcode.z.ai), `packages/services/src/official-mcp/*`, quota provider.
- Feedback: `feedbackService.ts` sends JWT auth to vendor; `config/default.json:2` Zhipu Feishu feedback URL; `:5-7` Feishu community links.
- CLI auth: `apps/zcode-cli` — `login-command.ts`, `auth/cli-oauth.ts`, `auth/bigmodel-oauth.ts`, `auth/coding-plan-api-key.ts` (auto-provisions vendor key `zcode-api-key`), `tui/app-submit.ts:296` regex, `zcode-slash-command-help.ts:23,29`.
- Gateway rewrite: `adapters/src/model/official-coding-plan-gateway.ts:22-31` silently reroutes vendor anthropic endpoints to `{ZCODE}/api/v1/ultra[-zai]/...`.

### 2.5 Tools/skills bound to vendor

- WebSearch tool (`core/src/tool/handlers/websearch.ts` + contracts + `tool-transform.ts:245-278` anthropic-only encoding + `supportsNativeWebSearch` plumbing + UI metadata editor) — primarily vendor-endpoint-enabled.
- OffPeakCreate/OffPeakList tools (`off-peak.ts`) — vendor ticket service.
- image-search plugin — vendor-hosted MCP with `zcode_official` auth.
- `"X-ZCode-Agent": "glm"` header on every model request (`bootstrap/src/model-config.ts:63`); `glm:` skill-catalog prefix contract (`skill-reference-catalog.ts:56-57`, `skillSourceFilter.ts:16`, `PermissionDialog.tsx:165`, `display-help.ts:4,13`).

### 2.6 Vendor infra & telemetry

- Auto-update: `manifestUpdateProvider.ts` polls `{ZCODE}/api/v1/releases/electron/manifest` hourly with `device_mid`; force-update gate `forceUpdateGuard.ts:217-254` via `/api/v1/client/configs` (prerelease-aware semver — hazardous for alphas).
- Remote asset CDN: `remoteCdn.ts:4` `https://cdn-zcode.z.ai` (`/zcode/electron/releases/<v>` hardcoded suffix); server `remoteAssetCdn.ts` nested-path candidate builders; remote deploy components (`node/<platform>`, `node-pty`, server bundle).
- Plugin marketplace: `plugin-marketplaces.ts:32-42` official CDN source; `official-plugin-definitions.ts:60-61` `ZAI_AUTHOR` + cdn assets base; pinned default-enabled list incl. image-search.
- Conversation share: `conversationShareService.ts:721` publishes to `{ZCODE}/cn/share`; web landing download link.
- Telemetry: ARMS RUM (`appARMSBootstrap.ts` + ~12 senders + `@arms/rum-electron` dep/patch + device_mid) — env-gated dormant; 数仓 (`telemetryCore.ts` + UI funnel senders) — env-gated dormant.
- Identity: `electron-builder.config.js:462-465,706` homepage/author/maintainer `zcode.z.ai` / `dev@zcode.z.ai`; systemd/launchd service `com.zhipu.zcode.server` (`zcode-server-cli/src/platform/serviceManager.ts:33,49`); `zai-dark` theme id; vendor logos (`model-provider-logo-sources.json:26-47`, `GlmMonochromeIcon`); i18n vendor strings (packages/ui + apps/zcode-cli locales); WebFetch UA URL.

### 2.7 Key survival facts

- Agent core (tools/runtime/session UI/provider overlay) is provider-agnostic; BYO-API-key path exists end-to-end (16 templates + custom baseURL).
- Gateway rewrite adds nothing client-side (URL rewrite only; auth headers identical; OAuth merely minted a normal console key) → zai/bigmodel endpoints work with plain API keys via the standard templates.
- `packages/server` auth is self-issued (`ZCODE_SERVER_AUTH_TOKEN`; `ZCODE_SERVER_TOKEN` only affects the advertised `authRequired`); IM bot relays are third-party clouds with local pairing; no proprietary relay ships in-repo.

---

## 3. Locked decisions (user-fixed)

| #   | Decision                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Hard-cut everywhere.** Delete all GLM migrations (0020/0021/0022 + v3 SQL), `OFFICIAL_GLM_MODEL_IDS`, legacy vendor readers, `providerFamilyDomain` field. No compat shims.                                                                                                                  |
| D2  | **Rename `glm` → `zcode`** everywhere (enum, protocol events, env `GLM_BINARY_PATH`→`ZCODE_AGENT_BINARY_PATH`, resource dir `glm/`→`zcode/`, skill prefix `glm:`→`zcode:`, remote package id, signIgnore). Single value, no dual-enum transition. zai/bigmodel stay as equal ordinary vendors. |
| D3  | **Conversation share: local markdown export only.** Delete vendor-hosted publishing + web landing + `zcode://share/import`. Build local export.                                                                                                                                                |
| D4  | _(rescinded)_ Remote-asset bundling into the installer rejected — replaced by GitHub Releases hosting + runtime env overrides.                                                                                                                                                                 |
| D5  | **No WebSearch tool.** Delete tool + all capability plumbing. Users who want search configure an MCP server (e.g. mcp-searxng).                                                                                                                                                                |
| D6  | **Keep IM bots** (weixin/feishu/lark/telegram/webhook).                                                                                                                                                                                                                                        |
| D7  | **Rename services** `com.zhipu.zcode.server` → `app.zcode.server`; no installed-service migration needed (no existing users).                                                                                                                                                                  |
| —   | **OTel-only telemetry**, env-gated opt-in (`OTEL_EXPORTER_OTLP_ENDPOINT`); backend-agnostic by protocol (user supplies any OTLP backend).                                                                                                                                                      |
| —   | **zai/bigmodel = equal vendors**: templates kept as plain `api-key`; Coding-Plan branding/flows removed; anthropic + openai API flavors both kept per vendor.                                                                                                                                  |
| —   | **No GLM-id-keyed rules.** Model metadata auto-discovered via standard listing routes (`GET /v1/models`, openai-compat + anthropic).                                                                                                                                                           |
| —   | **Off-peak kept, vendor-agnostic**: local admission/execution backend; vendor server client deleted.                                                                                                                                                                                           |
| —   | **Vendor-hosted MCP removed** (official-mcp auth + quota + image-search plugin dependency).                                                                                                                                                                                                    |
| —   | **Version pinned to upstream 3.14.3** with per-phase alphas; delete existing `v3.14.3` tag + orphaned GitHub Release first.                                                                                                                                                                    |

---

## 4. Phase plan

**Order (compile-safe, verified): P0 → P2 → P1 → P3 → P4 → P5 → P6.** Each phase lands green (`pnpm typecheck && pnpm lint && pnpm fmt:check && pnpm architecture:check --changed && pnpm knip` + tests) and is released as one alpha. Rationale: `providerFamilyDomain` (~30 UI files) and the startup gate must be reworked (P2) **before** the schema excision (P1) deletes the field; OAuth deletion (P3) must come after its replacements exist; rename (P4) after protocol excision to avoid churning `zcode-protocol/index.ts` twice.

### P0 — Telemetry: OTel-only + update-path guards → **alpha.1**

**Changes:**

1. Delete ARMS RUM: `appARMSBootstrap.ts`, `armsRumShared.ts`, `armsRumBridgeForward.ts`, `armsEventRedaction.ts`, telemetry senders (`desktopStabilityTelemetry.ts`, `databaseStartupTelemetry.ts`, `desktopNetworkTelemetry.ts`, `desktopMcpTelemetry.ts`, `desktopZCodeDataSizeTelemetry.ts`, `desktopResourceTelemetry.ts`, `desktopRemoteUsageArmsTelemetry.ts`, `sendFunnelArmsTelemetry.ts`), `@arms/rum-electron` dep + `patches/@arms__rum-electron@0.0.3.patch` + preload bridge; drop from `third-party/inventory.json` + notices.
2. Delete 数仓: `packages/services/src/telemetry/telemetryCore.ts`, UI funnel senders (`sessionCreateTelemetry.ts`, `codingPlanFunnelTelemetry.ts`, `offPeakTelemetry.ts`, `useOnboardingTelemetry.ts`, `automationTelemetry.ts`), desktop `device_mid` (`desktopDeviceMid.ts`, `telemetry-state.json` usage). **Keep** CLI OTel module's own anonymous identity (`apps/zcode-cli/packages/telemetry/src/bootstrap.ts:223-262`).
3. Keep/extend existing OTLP agent telemetry (opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT`); update `packages/shared/src/env.ts:48-58` plumbing accordingly.
4. **Update-path guards (provider-keyed, NOT version-keyed)** while `ManifestUpdateProvider` (vendor feed) is still wired:
   - startup + hourly poll → route through existing `enabled:false` early-return (`autoUpdater.ts:1463-1471`);
   - manual "check for updates" → fail-closed via `autoUpdaterDisabledForProductFlavor` (UI shows disabled/dev-skipped message);
   - force-update gate → explicit skip in/around `maybeBlockStartupForForceUpdate` (`forceUpdateGuard.ts:217-254`) so vendor `/api/v1/client/configs` can never hard-block alphas.
     All three re-enabled in P5 with the GitHub provider (alpha→alpha updates then work). Guard keyed to feed provider so it does not block P5's own updates.

**Why / consequence / UX / alternative:**

- _Why:_ silent vendor phone-home (crash dumps, perf, persistent `device_mid`, funnel events) and vendor control over app startup/updates.
- _Consequence:_ vendor dashboards dark; updater dormant until P5.
- _UX degradation:_ none (telemetry already dormant without env; updater on alphas must not reach the vendor feed since semver `3.14.3 > 3.14.3-alpha.N` would auto-migrate testers onto vendor builds).
- _OSS alternative:_ user's own OTLP backend (Jaeger / Grafana LGTM / SigNoz / Prometheus — any OTLP-compatible; OpenTelemetry is Apache-2.0).

**Tests/QA:** unit — telemetry init no-ops across env matrix; no device_mid persistence; updater disabled on all three paths (delivered: `packages/shared/test/updateFeedPolicy.test.ts`). Integration — boot app, assert zero outbound calls to vendor **telemetry/manifest** endpoints (help-config/context-prompt rollouts still fetch `/api/v1/client/configs` on demand until P2/P3 — scope assertions accordingly). Electron-main network harness deferred to P6's CI deliverable. Manual (fresh Windows install) — run a session, verify no vendor telemetry/update traffic; "check for updates" shows disabled.

### P2 — Onboarding & gate rework → **alpha.2** (done; before schema surgery)

Delivered as `v3.14.3-alpha.2` (merge `8e06f90`); wizard layout/header/window-controls hotfix in `v3.14.3-alpha.3` (merge `be6204b`): gate = `!hasUsableProvider && !onboardingDismissed` (new optional `providerOnboardingDismissedAt` setting; waits for settings+model-selection hydration with error escapes); wizard with neutralized template catalog + custom/Ollama path + services-layer direct-HTTP test-key probe (superseded by P1 discovery); web token login page (fetch-status-only gate); feedback → GitHub Issues with redacted prefill, in-app center fully deleted, help config local-only. Extras landed in the same alpha: first e2e harness (Playwright, web build + mock provider, 8 scenarios) + ui/shared node-test suites, and ALL root+CLI format/lint baseline debt cleared (repo lint 0/0, fmt green both workspaces; CLI config-scoping bug fixed).

**Changes:**

1. New startup gate: proceed iff ≥1 usable provider configured; else welcome wizard. Remove `providerFamilyDomain`-based gating (`useProviderAvailabilityLoginEntryGuard.ts:57`, `rootStartupGate.ts:18-21,57-58`) — full field deletion happens in P1; here we stop reading it.
2. Welcome wizard: provider picker from catalog templates (zai/bigmodel as ordinary entries + kimi/deepseek/openai/anthropic/… + custom + Ollama), per-template API-key entry with "test key" probe. Reuse `ProviderTemplatePicker`, `LoginApiKeyForm`, onboarding dialog shell.
3. Self-hosted web login (P2 revision, source-verified): token-only login page served by `packages/server` itself (enforcement var is `ZCODE_SERVER_AUTH_TOKEN`, not `ZCODE_SERVER_TOKEN` — the latter only affects the advertised `authRequired` when the server is created programmatically without options). The `zcodejwttoken` read at `remoteWorkspaceServiceCollection.ts:84` was mislabeled in this plan: it is conversation-share publish auth and dies with share in P5 item 4. `providerFamilyDomainMigration.ts` deletion moved from P1 item 2 into P2 item 1 (startup-path writer; sole importer is the Root startup effect P2 removes).
4. Feedback → anonymous GitHub Issues link (`https://github.com/yeyuan98/ZCode/issues/new`, context prefilled; user decisions D-P2: delete the whole in-app feedback center now — UI, `IFeedbackService`, vendor HTTP client, local ticket store, device-id plumbing; zh-CN `community_urls` → `https://github.com/yeyuan98/ZCode/discussions`; en-US Discord stays). Help config (feedback/community URLs) resolves local-only; the remote help-config fetch dies here (context-prompt rollout stays until P3).

**Why / consequence / UX / alternative:**

- _Why:_ current guard opens the login screen whenever the vendor-family field is unset — post-purge that is every user, permanently; vendor OAuth onboarding is removed.
- _Consequence:_ new wizard is net-new build (not a deletion).
- _UX degradation:_ none after redesign — arguably better (neutral first-run); one-click vendor OAuth convenience is gone by design. (A2 note: the Ollama builtin template lands in A3/P1; at A2 local models work via the custom OpenAI-compatible endpoint `http://localhost:11434/v1`.)
- _OSS alternative:_ BYO API key for any of 16+ providers; local models via Ollama (MIT, OpenAI-compatible API at `http://localhost:11434/v1`) or vLLM (Apache-2.0).

**Tests/QA:** unit — gate logic (usable-provider count), wizard template list content, key-probe. E2E (new harness — explicit deliverable) — first-run wizard → configure key → workspace; skip path. Manual — fresh install wizard with a real key and with local Ollama.

### P1 — Catalog & schema excision + model auto-discovery → **alpha.3**

**Changes:**

1. `config/provider/zcode-builtin.json`: convert zai/bigmodel templates to plain `api-key` access (delete `zhipu-coding-plan-api-key` type usage); delete 8 `account:*` providers; delete ALL GLM-id-keyed rules (24 modelRules + template/builtin provider rules); delete `supportsNativeWebSearch` capability rules (tool itself dies in P4 — flags die here with the catalog); keep the 16 generic templates; **add `ollama` template** (`openai-chat-completions`, `http://localhost:11434/v1`).
2. Schema excision: `zhipu-account`/`zhipu-coding-plan-api-key` from zod (`provider-data-schema.ts:32,43`), `ZhipuAccountAccessConfig` (`provider-config.ts`) + overlay layer, protocol schemas (`zcode-protocol/index.ts:812-850`, `provider-family-connection-selection.ts`, `usage-quota.ts`, `usage-stats.ts`, `plan-identity.ts`, `coding-plan-subscription.ts`), `model-provider-family.ts` family plumbing, `model-provider-types.ts` vendor ids, `providerFamilyDomain` AppSettings field + validation + `normalizeSettingsPatch.ts`/`protocol.ts` writes (its startup migration file moved to P2), `modelVisionBadge.ts` coding-plan exception.
3. History deletion (hard-cut): migrations `0020-provider-model-selection.ts`, `0021-official-glm-selection.ts`, `0022-backfilled-session-reasoning.ts`, `services/src/session/tasksDatabase/official-glm-selection-v3.ts`, `official-glm-model-id.ts`, `legacyZCodeConfigProviderReader.ts` vendor parts, `legacyAccountConnectionSettings.ts`, `telemetryRedaction.ts` vendor whitelist.
4. **NEW: model auto-discovery** — net-new HTTP client querying standard listing routes (openai-compat `GET /v1/models`, anthropic `GET /v1/models`; nothing exists today — `ListModels` tool is in-memory only), merged into provider views; doubles as P2's "test key" probe. Covers the risk that a plain key may not call every model on zai/bigmodel anthropic endpoints (external product behavior — validate at runtime, never promise).

**Why / consequence / UX / alternative:**

- _Why:_ vendor account types welded into every schema/protocol; GLM-id rules violate vendor-equality.
- _Consequence:_ wide but mechanical compile fan-out; vendor-plan providers disappear (intended).
- _UX degradation:_ vendor-plan users lose account providers (accepted, fresh start); BYO-key/local users unaffected; model lists become auto-discovered instead of hardcoded.
- _OSS alternative:_ discovery works with any OpenAI-compatible endpoint incl. Ollama/vLLM.

**Tests/QA:** unit — catalog loads (16 generic + 4 zai/bigmodel plain-key + ollama), no vendor account types survive validation, discovery client against mocked openai/anthropic responses (incl. error/empty), merge logic. Manual — wizard discovers real models for a real key and local Ollama; GLM rules absent; provider metadata editor works.

### P3 — Services purge + off-peak local backend → **alpha.4**

**Changes (deletions):**

1. OAuth: `packages/services/src/oauth/**`, `packages/web/src/auth/**` (incl. `browserOAuthCredentialRepo.ts`).
2. Billing/quota: `coding-plan-subscription/**`, `usage-stats` bigmodel/zai/mcp providers, `zaiStartPlanBilling.ts`, `codingPlanProviderAvailability.ts`, `teamPlanApiKey.ts`, `services/src/bigmodel/codingPlanEntitlement.ts`, `model-provider/accountProviderApiClient|ApiTypes|RequestAuthService|TeamPlanRequestKey.ts`, `bigmodelStartPlanZcodeJwt.ts`, `legacyAccountConnectionSettings.ts` (if not already in P1), PayPal approveUrl interception (`desktopWindowChrome.ts:290-293`, `desktopMainIpcRemote.ts:73-87`).
3. Official MCP: `official-mcp-auth.ts`, `services/official-mcp/*` (credentials + issuance audit), `zcodeMcpQuotaProvider.ts`, `requestOfficialMcpAuthHeaders` resolver in `zcodeAgentService.ts`; image-search plugin becomes unusable (dropped in P5's marketplace rework).
4. Vendor off-peak server binding: `offPeakServerClient.ts`, mock gateway, JWT/plan-key auth in `offPeakRuntimeModel.ts`, `offpeak-retry.ts` vendor codes, fixed-provider `offPeakModelSelectionView.ts`.

**Changes (new build):** 5. **Off-peak vendor-agnostic re-architecture** (same changeset — service compiles against the client today): define `OffPeakAdmissionBackend` interface; local implementation decides `schedulable` from a user-configured idle window (time-range and/or user-idle); creation persists immediately (no ticket); retire ticket schema columns (`server_ticket_id`, `registered_at`, `schedulable`, `queue_position`, `next_poll_at`, `settled_at` in `tasksDatabase/schema-v1.ts:148-180` — hard-cut schema); dispatch against the task's already-persisted `model_selection` (user's own provider); keep scheduler utility process (claim→dispatch→settle, interrupted-recovery), dispatch 3-branch plan, UI (eligibility switched to user selection). Product decisions to settle in-phase: idle-window definition, permission-mode safety for unattended runs. 6. Credential service stays (generic: MCP OAuth, remote tokens, provider keys).

**Why / consequence / UX / alternative:**

- _Why:_ entire vendor account/billing/quota middle-tier; server-side off-peak execution.
- _Consequence:_ large deletion surface; off-peak backend is the biggest single new build.
- _UX degradation:_ vendor login/purchase/quota panels gone (replaced by P2 wizard); off-peak keeps working — now on user's own providers during local idle windows (no more free vendor compute — inherent to de-vendorization).
- _OSS alternative:_ none needed beyond user's own providers; scheduling itself was always local-first.

**Tests/QA:** unit — local admission policy (idle window), create→dispatch→settle against user provider, schema without ticket columns; deletion compile gates. Integration — scheduler utility-process round-trip (harness = explicit deliverable). Manual — queue a task in the idle window, verify local execution + notification; OAuth/plan/quota UI absent; IM bots still function.

### P4 — CLI runtime: rename + WebSearch removal → **alpha.5**

**Changes:**

1. **Rename `glm` → `zcode`** (~200 refs/65 files): `providers.ts` enum, `ZCODE_AGENT_PROVIDER`, protocol event `glm_agent_model_state_update` → `zcode_agent_model_state_update`, `X-ZCode-Agent` header value (`bootstrap/src/model-config.ts:63`), `GLM_BINARY_PATH`→`ZCODE_AGENT_BINARY_PATH` (`zcode-agent-runtime.ts:26-41`), `bundledResourceDir` `glm`→`zcode`, `resolveBundledGlmBinaryPath` (`desktopHostProcess.ts:50,252,285`), remote-resource package id (`remoteResourcePackages.ts:5,17`), deploy path segments (`zcodeAgentDeploy.ts:174-272`), electron-builder resource dir + signIgnore regex (`electron-builder.config.js:630-633,689`), `scripts/prepare-prebuilds.mjs` staging (`nonReusableReleaseAssetIds`, `glm/` component dir), skill-catalog prefix `glm:`→`zcode:` incl. UI contract (`skill-reference-catalog.ts:56-57`, `skillSourceFilter.ts:16`, `PermissionDialog.tsx:165`, `display-help.ts:4,13`), agent-provider icon (`GlmMonochromeIcon.tsx` + `providerCliIcon.tsx`).
2. Delete: coding-plan gateway rewrite (`official-coding-plan-gateway.ts` + wiring in `model-execution.ts`/`runner.ts`); vendor business-code maps (3008-3010/3105/3102) across all carriers — `streaming-recovery.ts:16`, `failure-provider-business-codes.ts`, `contracts/src/model/index.ts`, `bootstrap/src/zcode-protocol-v4/product-projection.ts`, `bootstrap/src/app/workflow-concurrency-governor.ts`, `adapters/src/model/runner-generate.ts`, `runner-stream.ts`, and UI `providerBusinessError.ts:149,230`; CLI vendor auth files (`cli/src/login-command.ts`, `adapters/src/auth/cli-oauth.ts`, `auth/bigmodel-oauth.ts`, `auth/coding-plan-api-key.ts`) + slash-command help (`zcode-slash-command-help.ts:23,29`) + `tui/app-submit.ts:296` regex; z.ai webview workaround (`browserPlaywrightLocatorExecutor.ts:315`); WebFetch UA URL → repo value (`webfetch-constants.ts:11`); CLI i18n vendor strings beyond WebSearch keys (`apps/zcode-cli/packages/i18n/src/locales/*.ts`).
3. **Delete WebSearch entirely:** `websearch.ts` + `websearch-results/support.ts`, `contracts/src/tools/websearch.ts`, `tool-transform.ts:245-278` branch, required schema field `supportsNativeWebSearch` (`shared/model-config.ts:76`, `provider/src/config/model-config.ts:184`, `manual-model-config.ts:14` default, `tools/prompt-trajectory/record.ts:337`), exposure gate (`runtime/methods/config.ts:268-273`), tool-identity/permission aliases (`tool-identity.ts:10,66` incl. `"search"` alias, `explore-tools.ts`, `microcompact.ts:25`, `permission/service.ts:562`, `profile.ts:78`, `provider-visible-order.ts:30`, `tool-visibility.ts:2`), UI metadata editor fields (`ProviderModelMetadata.ts`, `ProviderModelDraftState.ts`, `ProviderModelMetadataDialog.tsx`), i18n keys both locales (ui + cli).
4. Keep (behavior-keyed; neutralize GLM-citing comments): compact empty-length finish guard, MaaS tool_result parsing, workflow submit_result arg coercion, `anthropic-stream-compat.ts` thinking-signature handling, ai-sdk video patches.
5. Theme id `zai-dark` → `zcode-dark` (fresh start, no fallback).

**Why / consequence / UX / alternative:**

- _Why:_ vendor identity in the runtime protocol, silent traffic rerouting, vendor-product error semantics; WebSearch was vendor-endpoint-shaped with no generic fallback by design.
- _Consequence:_ wire rename orphans any old remote peers (accepted); packaging changes require smoke test.
- _UX degradation:_ WebSearch tool gone — users wanting agent web search configure an MCP server; everything else invisible.
- _OSS alternative:_ SearXNG (AGPL-3.0, self-hosted metasearch; JSON API `GET /search?q=…&format=json`, requires `formats` enabled in settings) via `mcp-searxng` MCP server — document in README as the recommended setup.

**Tests/QA:** unit — protocol events with new name; skill catalog `zcode:` prefix; tool registry without WebSearch (schema/permissions/tool-identity updated); binary resolution via `ZCODE_AGENT_BINARY_PATH` + bundled `zcode/` dir (extract resolution logic into `packages/services` unit-testable module). `pnpm smoke:windows-bundle` (packaging changed). Manual — agent spawn E2E on the Windows installer; permission prompts; no WebSearch anywhere; MCP server works as search replacement (spot-check).

### P5 — Infrastructure re-pointing → **alpha.6**

**Changes:**

1. **Auto-update → electron-updater GitHub provider:** `.github/workflows/release-desktop.yml` uploads `latest.yml` + `.exe.blockmap` (+ `beta.yml` if preview channel kept, mapped to `allowPrerelease`); `publish: {provider:"github", owner, repo}` in `electron-builder.config.js` (replacing the localhost generic placeholder + `dev-app-update.yml`); delete `ManifestUpdateProvider` + force-update gate; rework stable/preview channel UI logic to the GitHub model; **re-enable the three P0 update paths** (guard was provider-keyed so alpha→alpha updates now work — first real in-app alpha→alpha verification happens at A7, since A1–A6 builds all carry the disabled updater); **make the mirror override real**: `ZCODE_UPDATE_FEED_URL` is currently ignored in packaged builds (`autoUpdater.ts:703-710` `isPackaged` guard; NOTICE.md:49) — remove that guard so it becomes a genuine runtime mirror escape hatch (CN reachability), and update NOTICE.md. `pnpm smoke:windows-bundle` before pushing workflow changes (mandatory per AGENTS.md).
2. **Remote assets → GitHub Releases:** flat-named per-version-tag assets (`zcode-linux-x64.tar.gz`, `manifest-linux-x64.json`, node/node-pty per-platform components); rework URL builders — desktop `remoteCdn.ts:29-31` hardcoded `/zcode/electron/releases/<v>` suffix and server `remoteAssetCdn.ts` nested-path candidate builders; collapse 404-probe candidates (GitHub unauthenticated rate limit 60 req/hr/IP); keep runtime overrides for self-host/mirrors — note `ZCODE_CDN_BASE_URL` is currently a **build-time** define (`desktop/tsup.config.ts:112`), so `ZCODE_REMOTE_ASSET_CDN_BASE_URL` (runtime) is the user-facing mirror knob, or make `ZCODE_CDN_BASE_URL` runtime-resolved; document mirror guidance. Note: per-remote-platform node binaries cannot be bundled into one installer — GitHub Releases (or mirror) is the complete solution.
3. **Plugin marketplace:** remove official CDN default + `ZAI_AUTHOR` + `OFFICIAL_PLUGIN_ASSETS_BASE_URL` (`official-plugin-definitions.ts:57-58`); store = repo-bundled plugins + Personal Sources (git/URL/local — already supported); default marketplace source configurable; drop image-search plugin (vendor MCP); fix pinned-list bootstrap test (`plugin-marketplaces.ts` parity comment); update CONTEXT.md concepts (Official Marketplace/CDN/Featured).
4. **Conversation share → local export only:** delete `conversationShareService.ts` publish path, web landing page, `zcode://share/import`; **build** local markdown session export (net-new; reuse share turn-serialization concepts).
5. **Identity:** `electron-builder.config.js` homepage/author/maintainer → repo values; service names → `app.zcode.server`; WebFetch UA URL neutral; vendor logos removed from `model-provider-logo-sources.json` registry (zai/bigmodel logos stay as ordinary provider icons).

**Why / consequence / UX / alternative:**

- _Why:_ distribution must not depend on vendor API/CDN.
- _Consequence:_ update chain self-owned (GitHub Releases, MIT-licensed electron-updater native flow); asset publication workflow is new; share hosting gone.
- _UX degradation:_ update UX equivalent (native updater flow, now from GitHub; CN users may need the feed override/mirror — documented); conversation share becomes local export (accepted, D3).
- _OSS alternative:_ GitHub Releases (standard OSS distribution); generic provider for fully self-hosted update feeds; any static host for assets via env overrides.

**Tests/QA:** unit — URL builders produce flat GitHub asset URLs; updater parses `latest.yml`; feed override honored in packaged builds. Integration — `ZCODE_AUTO_UPDATE_DEV` loop against fixture feed. `pnpm smoke:windows-bundle`. Manual — install A6 over A5 manually (updater disabled on A1–A5 by design); verify in-app update machinery against the dev fixture feed; remote SSH workspace downloads assets from GitHub Releases; overrides work. Real in-app alpha→alpha update is verified at A7 (A6→A7).

### P6 — Cleanup, sweep gate, RC → **alpha.7** (RC), then **final 3.14.3**

**Changes:**

1. `scripts/check-vendor-free.mjs` — zero-hit gate for `zcode\.z\.ai|cdn-zcode|chat\.z\.ai|zhipu-account|com\.zhipu|glm` (**case-insensitive** so `GlmMonochromeIcon`-style prefixes can't slip through); allowlist: `z.ai`/`bigmodel` only as provider display names, baseUrls, logo keys, key-management URLs. Wired into `verify:pre-push` **and a new PR CI workflow** (none exists today — net-new deliverable; lint + architecture check + tests + vendor-free gate).
2. Third-party notices regen incl. `third-party/inventory.json` (ARMS removal).
3. Docs: `.env.example` (drop `ZAI_*` platform vars; keep plain provider keys), AGENTS.md, CONTEXT.md, README/README.en.md (Ollama/vLLM setup, MCP search guidance, mirror guidance).
4. Full dogfood pass of the RC; final release (see §5).

**Why / consequence / UX / alternative:**

- _Why:_ guarantee no vendor residue ships in the final build; establish permanent regression gates.
- _Consequence:_ new CI workflow + lint gate are net-new maintenance surface.
- _UX degradation:_ none — cleaner docs and onboarding guidance (Ollama/vLLM, MCP search, mirrors).
- _OSS alternative:_ n/a (gate itself enforces the OSS posture).

**Tests/QA:** full matrix re-run on the RC build + final; in-app update to final verified from A6/A7 lineage (A1–A5 lineages upgrade via manual installer — updater intentionally disabled until P5).

---

## 5. Versioning & release runbook (verified against installed release-it 19.2.4)

**Alpha policy (user ruling, binding for all phases):** between alphas and until the final
3.14.3, the program is development-first — code completeness/robustness/cleanliness take
priority; alpha-user experience may break; reinstall/re-initialization of settings may be
required; NO compatibility or migration code for alpha→alpha upgrades.

Source-verified mechanics (installed `node_modules/release-it` + `@release-it/conventional-changelog`):

- In this repo's config (`.release-it.mjs` + conventional-changelog plugin without `ignoreRecommendedBump`), the **plugin disables release-it's version plugin** and computes recommended versions itself (`@release-it/conventional-changelog/index.js:52-54,80-170`); `latestVersion` resolves from **package.json** (`npm.js:29-31`); git tags only bound the changelog range (`GitBase.js:108-125`).
- **Explicit valid versions are returned verbatim** (`index.js:118-120`, no `gte` check) → explicit pins are deterministic and immune to tag state.
- Bare `--preRelease --ci` continuation works **only** with zero stable tags in the repo (a stray stable tag flips results to `3.14.4-0`/`3.15.0-0` via the recommended-bump path) — hence tag deletion is load-bearing for that variant, and explicit pins are preferred.
- electron-builder accepts prerelease versions; artifact `ZCode-3.14.3-alpha.N-win-x64.exe` matches workflow globs; tag trigger `v*` matches; softprops creates the Release for a new tag.

**Runbook:**

1. **Pre-step** (chore commit): delete tag `v3.14.3` (local + remote) **and** the orphaned GitHub Release `v3.14.3` (softprops would leave an orphan; final re-tag needs a clean slate).
2. **Per alpha (A1..A7):** `pnpm release --increment=3.14.3-alpha.<N> --ci` — always preceded by a dry check: `pnpm release --increment=3.14.3-alpha.<N> --ci --release-version` (prints target, exits; catches mis-resolution). Tag `v3.14.3-alpha.N` pushes trigger `release-desktop.yml`.
3. **Workflow tweak:** add `prerelease: ${{ contains(github.ref_name, '-') }}` to the softprops step.
4. **Final:** `pnpm release --increment=3.14.3 --ci --release-version` (verify `3.14.3`) then execute → exact `3.14.3`, non-prerelease Release.
5. **Changelog:** default behavior — each alpha gets its own entry (alpha.1's entry spans full history because no tags remain — one-time blob, optionally pruned in a follow-up docs commit); final entry = commits since alpha.7. `--git.tagExclude='*[-]*'` on final would span full history instead — not recommended.
6. CLI/agent-internal versions unchanged.

---

## 6. Per-phase vetting gates (mandatory)

Every phase, before its alpha tag:

```
pnpm typecheck && pnpm lint && pnpm fmt:check && pnpm architecture:check --changed && pnpm knip
node --test (per-package test suites — see below)
pnpm smoke:windows-bundle   # required at A5 and A6 (packaging/workflow changes); Docker + 15 GiB disk
```

Manual: fresh Windows install of the alpha + upgrade from the previous alpha; phase-specific checks per §4.

**Test infrastructure (net-new deliverables, created where first needed):**

- Add `"test": "node --test test/"` scripts to `packages/services`, `packages/ui`, and each package gaining tests (Node 24 runs `.ts` natively; node:test + node:assert/strict — matches the existing 4 test files: services ×3, ui ×1).
- Electron-main integration harness (P0 network-assert, P3 scheduler round-trip) — explicit deliverable.
- Wizard E2E (P2) — explicit deliverable.
- New PR CI workflow (P6): lint + architecture check + all test suites + vendor-free gate.

**Matrix summary:**

| Alpha | Phase | Key automated checks                                                                                                   | Key manual checks                                                                                                            |
| ----- | ----- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A1    | P0    | telemetry no-op units; updater-guard units                                                                             | no vendor telemetry/update traffic on fresh install; updates disabled (help-config fetch on user action remains until P2/P3) |
| A2    | P2    | gate/wizard units; wizard E2E (new harness) — delivered: ui 20 + shared 9 unit tests, 8 e2e specs; all-lint-zero bonus | first-run wizard with real key + Ollama; `/remote` token login                                                               |
| A3    | P1    | catalog/schema units; discovery client units (mocked)                                                                  | discovery with real key + Ollama; no GLM rules                                                                               |
| A4    | P3    | off-peak local backend units+integration (new harness)                                                                 | off-peak runs locally; plan/quota UI gone; IM bots work                                                                      |
| A5    | P4    | rename/protocol/tool-registry units; binary-resolution units; **smoke**                                                | agent spawn on installer; no WebSearch; MCP search spot-check                                                                |
| A6    | P5    | URL-builder/updater units; dev update loop; **smoke**                                                                  | install A6 over A5 manually; update machinery via fixture feed; remote assets from GitHub; overrides work                    |
| A7    | P6    | vendor-free gate in new CI; full suites                                                                                | full dogfood RC pass; real in-app update A6→A7                                                                               |
| Final | —     | full matrix re-run                                                                                                     | in-app update A6/A7→final; A1–A5 manual-installer upgrade                                                                    |

---

## 7. Effort estimate

| Item                                                              | Estimate                  |
| ----------------------------------------------------------------- | ------------------------- |
| P0 (incl. 3 updater guards)                                       | 3–5 d                     |
| P2 onboarding wizard + gate                                       | 5–8 d                     |
| P1 excision + auto-discovery + Ollama template                    | 7–11 d                    |
| P3 deletions + off-peak local backend                             | 13–19 d                   |
| P4 rename + WebSearch removal                                     | 4–6 d                     |
| P5 update/assets/marketplace/share-export/identity                | 9–12 d                    |
| P6 sweep gate + CI workflow + docs + notices                      | 3–4 d                     |
| Versioning/QA overlay (test scripts, harnesses, release dry-runs) | 3–4 d                     |
| **Total**                                                         | **≈ 7–10 engineer-weeks** |

---

## 8. Risks & mitigations

1. **Off-peak local redesign** (biggest new build; product questions: idle-window definition, unattended-run permission safety) — spec first, prototype admission policy early in P3.
2. **Plain-key model coverage on zai/bigmodel anthropic endpoints** is uncontracted external behavior — discovery-based validation at wizard time; never advertise models a key can't call.
3. **CN reachability of GitHub** (updates/assets) — make `ZCODE_UPDATE_FEED_URL` honored in packaged builds (remove `isPackaged` guard) and document `ZCODE_REMOTE_ASSET_CDN_BASE_URL` runtime mirror; collapse probe candidates to respect rate limits.
4. **Residual brand leakage** (~2,400 hits/272 files initially) — mechanical phases + P6 `check-vendor-free.mjs` CI gate with explicit allowlist.
5. **Release mechanics** — explicit version pins + `--release-version` dry-check before every release; zero-stable-tags invariant documented for the bare-continuation alternative.
6. **Phase green guarantee** — locked order P0→P2→P1→P3→P4→P5→P6; any out-of-order landing risks non-compiling intermediates (`providerFamilyDomain` fan-out, off-peak client compile coupling).

---

## 9. Execution rules

- Branches: `agent/coder/vendor-purge-<phase>` per repo git policy; one phase per branch; each merges green and releases exactly one alpha.
- Specs before code (repo AGENTS.md rule): each phase starts by updating the relevant spec/docs section.
- All commands from repo root; Node version per `mise.toml` (24.14.0).
- Never bypass `pnpm release` (no manual tags — v3.14.3 changelog incident precedent); commit bodies carry itemized change bullets (changelog writer renders them).
- Secrets: none in repo (only public OAuth client id, which is deleted with the OAuth flows anyway).

## 10. OSS alternatives reference (researched, licenses verified)

| Capability              | Alternative                                                  | License         | Notes                                                                              |
| ----------------------- | ------------------------------------------------------------ | --------------- | ---------------------------------------------------------------------------------- |
| Local models            | Ollama                                                       | MIT             | OpenAI-compatible `/v1`; ships as new builtin template                             |
| Local models (server)   | vLLM                                                         | Apache-2.0      | OpenAI-compatible; custom provider                                                 |
| Agent web search        | SearXNG + mcp-searxng                                        | AGPL-3.0        | Self-hosted metasearch; JSON API (`formats` must be enabled); documented MCP setup |
| Telemetry backend       | Any OTLP consumer (Jaeger, Grafana LGTM, SigNoz, Prometheus) | Apache-2.0 etc. | OTel SDK/exporter is the only in-app telemetry                                     |
| Update distribution     | electron-updater GitHub provider                             | MIT             | Native, zero extra infra; artifacts already on GitHub Releases                     |
| Asset hosting           | GitHub Releases / any static host                            | —               | Flat-named assets + env overrides for mirrors                                      |
| Marketplace hosting     | Personal Sources (git/URL/local) + community repo            | —               | Already supported in-repo                                                          |
| Issue/feedback tracking | GitHub Issues                                                | —               | Replaces Zhipu Feishu form                                                         |
