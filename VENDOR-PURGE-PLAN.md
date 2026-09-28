# libre-zcode Vendor Purge — Master Plan

- **Repo:** `/home/administrator/git/ZCode` (fork of ZCode v3.14.3, branch base `main`)
- **Goal:** Remove all Z.ai / Zhipu / BigModel vendor-specific code — platform backend, logins, accounts/plans/subscriptions, vendor-bound skills/tools, vendor CDN/telemetry/infra — while keeping the product fully usable via generic API-key providers and local models. zai/bigmodel remain available as **ordinary, equal vendors**.
- **Version policy:** stay upstream-consistent at **3.14.3**; per-phase test releases as `3.14.3-alpha.N`; final release is exactly `3.14.3`.
- **Status:** P6 done (2026-09-28, merge `399c4cc` + CI-fix `fac9824`, release `aafb1ea`, tag `v3.14.3-alpha.10`; all assets verified 31; CI 5/5 green; manual A9→A10 update proof + dogfood pending on Windows). ALL CODE PHASES COMPLETE — remaining: manual QA above, then the final `3.14.3` release in a SEPARATE session (user directive; inherits the A10→3.14.3 in-app update proof and the §5 final step). History: P0 `alpha.1`; P2 `alpha.2`+hotfix `alpha.3`; P1 `alpha.4` (A1-A4); P1.1 `alpha.5` (merge `e1a14fc`); P1.2 `alpha.6` (merge `9821744`); P3 `alpha.7` (A6–A14); P4 `alpha.8` (merge `ea7c61b`, A-P4.1–3); P5 `alpha.9` (merge `ca30f8c`, A-P5.1–8); P6 `alpha.10` (directives + delivered state in its §4 section).
- **Fresh-start policy:** no migration/compat shims for old setups; there are no existing libre-zcode users.

---

## 1. Goals and non-goals

### Goals

1. No dependency on any Z.ai-operated service (`zcode.z.ai`, `chat.z.ai`, `api.z.ai` platform APIs, `open.bigmodel.cn` account APIs, `cdn-zcode.z.ai`).
2. No vendor accounts: OAuth login, coding-plan/start-plan/off-peak-**server** entitlements, in-app purchase, quota/billing panels — all removed.
3. No vendor telemetry: ARMS RUM and 数仓 event reporting removed; OpenTelemetry (OTLP) is the only, env-gated, opt-in telemetry.
4. No vendor-bound tools/skills: vendor-hosted MCP, provider-native WebSearch tool removed; off-peak kept but re-architected as vendor-agnostic local execution.
5. No GLM-specific model-id rules in the catalog; model lists auto-discovered via standard provider listing routes (P1.1/A5: model-id capability metadata rules are ordinary vendor-equal content and are kept/restored).
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

| #   | Decision                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **Hard-cut everywhere.** Delete all GLM migrations (0020/0021/0022 + v3 SQL), `OFFICIAL_GLM_MODEL_IDS`, legacy vendor readers, `providerFamilyDomain` field. No compat shims.                                                                                                                                                                          |
| D2  | **Rename `glm` → `zcode`** everywhere (enum, protocol events, env `GLM_BINARY_PATH`→`ZCODE_AGENT_BINARY_PATH`, resource dir `glm/`→`zcode/`, skill prefix `glm:`→`zcode:`, remote package id, signIgnore). Single value, no dual-enum transition. zai/bigmodel stay as equal ordinary vendors.                                                         |
| D3  | **Conversation share: local markdown export only.** Delete vendor-hosted publishing + web landing + `zcode://share/import`. Build local export.                                                                                                                                                                                                        |
| D4  | _(rescinded)_ Remote-asset bundling into the installer rejected — replaced by GitHub Releases hosting + runtime env overrides.                                                                                                                                                                                                                         |
| D5  | **No WebSearch tool.** Delete tool + all capability plumbing. Users who want search configure an MCP server (e.g. mcp-searxng).                                                                                                                                                                                                                        |
| D6  | **Keep IM bots** (weixin/feishu/lark/telegram/webhook).                                                                                                                                                                                                                                                                                                |
| D7  | **Rename services** `com.zhipu.zcode.server` → `app.zcode.server`; no installed-service migration needed (no existing users).                                                                                                                                                                                                                          |
| D8  | **Compile-forced natural death / no pre-hiding / no over-deletion.** Vendor-coupled UI dies when its data sources are excised (compile fan-out decides), never pre-hidden; protected later-phase files get surgical read-removal only. (Previously cited as "D5" in handoff prose — that was a misattribution; recorded as a numbered decision in P1.) |
| —   | **OTel-only telemetry**, env-gated opt-in (`OTEL_EXPORTER_OTLP_ENDPOINT`); backend-agnostic by protocol (user supplies any OTLP backend).                                                                                                                                                                                                              |
| —   | **zai/bigmodel = equal vendors**: templates kept as plain `api-key`; Coding-Plan branding/flows removed; anthropic + openai API flavors both kept per vendor.                                                                                                                                                                                          |
| —   | **No GLM-id-keyed rules.** Model metadata auto-discovered via standard listing routes (`GET /v1/models`, openai-compat + anthropic). _(Superseded by A5/P1.1 on the metadata half: capability metadata rules restored as equal-vendor content — see §4 P1.1; the model LISTS auto-discovered half stands.)_                                            |
| —   | **Off-peak kept, vendor-agnostic**: local admission/execution backend; vendor server client deleted.                                                                                                                                                                                                                                                   |
| —   | **Vendor-hosted MCP removed** (official-mcp auth + quota + image-search plugin dependency).                                                                                                                                                                                                                                                            |
| —   | **Version pinned to upstream 3.14.3** with per-phase alphas; delete existing `v3.14.3` tag + orphaned GitHub Release first.                                                                                                                                                                                                                            |

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

### P1 — Catalog & schema excision + model auto-discovery → **alpha.4** (done)

Delivered as `v3.14.3-alpha.4`: catalog = 21 equal-vendor templates (16 generic + 4 zai/bigmodel plain-`api-key`, de-branded, no `builtinModelIds` + ollama no-access template), zero `glm` (case-insensitive) / `zhipu` / `account:` / `supportsNativeWebSearch` strings in the catalog JSON (P1.1/A5 refined: glm allowed within modelRules capability metadata); settings field family (`providerFamilyDomain*` + `providerFamilyConnectionSelections`) deleted end-to-end (~45 files); `zhipu-account`/`zhipu-coding-plan-api-key` zod literals + `ZhipuAccountAccessConfig` + account overlay layer excised (provider + services + CLI adaptation, incl. compile-forced CLI login chain); GLM history deleted (id-chain, v3 selection migration + registration, legacy reader vendor parts, CLI migrations 0020-0022 with never-reuse ledger note); net-new discovery client `providerModelDiscovery.ts` (openai-compat + anthropic `/v1/models` with cursor paging, proxy-aware, no agent spawn) absorbs the P2 probe and powers wizard "test & discover" with mandatory model persistence (`initialModelIds` — without it the gate dead-loops on zero-model template providers); empty model lists degrade to failure per spec. Tests: services runner added (28 tests incl. catalog shape/schema-rejection/stale-personal.json containment), e2e wizard locks complete⇒usable + save-after-failed-discovery. Amendments recorded in-phase: **A1** protocol account schemas + 5 vendor entitlement schema files + `ProviderFamilyDomain` type/family specs/builtin ids stay until P3 (P3 files import them; `offPeakRuntimeModel`/`forceUpdate` must be reworked not broken); **A2** `legacyAccountConnectionSettings`/`legacyTeamOrganizationResolver` deleted in P1 (fed exclusively the deleted field); **A3** telemetryRedaction already delivered by P0; **A4** the compile-forced-death/no-pre-hiding ruling (previously mis-cited as "D5" — §3 D5 is WebSearch removal) is a binding numbered decision; CLI top-level `login`/`logout` + TUI `/login` `/logout` + vendor login picker died compile-forced (recorded in the spec expected-death list; shared `zcode-slash-command-help.ts` listing is P4). Also: `ModelPropertiesConfig` defaults `supportsNativeWebSearch:false` until P4 deletes the field; bigmodel-api key URL repointed to the API-key console; knip zero-new-entries gate held.

**Original plan (superseded where amended above):**

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

### P1.1 — Model capability metadata & discovery UX → **alpha.5** (done)

**Amendment A5 (numbered, in-phase):** restore GLM model-capability metadata rules into the builtin catalog's `modelConfigRules.modelRules` as ordinary equal-vendor content. Probe evidence (live key, both domains, all 4 listing endpoints HTTP 200): bigmodel/zai endpoints (`/api/paas/v4/models`, `/api/anthropic/v1/models`) return **ids only** — no openai-compat `context_length`, no anthropic `capabilities`/`max_input_tokens`; the anthropic mirrors are legacy-shaped (camelCase `hasMore`/`firstId`/`lastId`, cursor params ignored), while real Anthropic (`api.anthropic.com`) and OpenRouter do return usable metadata. Without catalog rules GLM became the only metadata-less major family (61 equivalent gpt/claude/kimi/deepseek/qwen/minimax/mimo/grok rules survived P1 — `codegeex-4`/`emohaa` already-cited precedent), degrading glm-5.3 to the `.*` default 200k/no-vision instead of 1M and losing glm-5.3-flash vision/video/pdf. User sanction: "we should consider reviving that mechanism". Rejected alternative: delete all 61 surviving vendor capability rules (would leave every major family metadata-less and worsen the equal-vendor posture). Scope (plan of record): **F1** — the 24 pre-P1 GLM capability rules restored verbatim from `0ed9c86` in original overlay order (composite `ox-alpha|glm-x-preview-f|x-preview-f-free` included; the P1-sanitized composite stand-in replaced; `templateModelRules`/`builtinProviderModelRules` stay glm-free; catalog invariant refined to "glm only within modelMatch patterns + capability properties"); **F2** — wizard auto-discovers on save whenever discovery state is idle (template + custom + keyless paths), so a saved provider always persists ≥1 model and never dead-loops the startup gate; **F3** — settings-tab per-provider "discover models" (services-side via `IProviderSettingsService`, key never surfaced to the renderer), bulk merge deduped against personal + builtin ids; **F4** — discovery parser hardening (legacy camelCase `hasMore` mirrors, repeated-first-id loop guard, 10-page cap backstop) plus optional metadata hints from real Anthropic/OpenRouter response shapes (hints fill only fields catalog resolution leaves empty; persisted as personal manual values). Version note: this phase takes `alpha.5`; subsequent phases re-shifted (P1.2 later re-took alpha.6; matrix: A5=P1.1, A6=P1.2, A7=P3 … A10=P6).

**Tests/QA:** unit — catalog glm-scoping (parse → null out `modelRules[].modelMatch` → no `/glm/gi` anywhere; `templateModelRules`/`builtinProviderModelRules` glm-free; rule count + glm-5.3 1M presence), resolver capability units (glm-5.3 → ctx 1M; glm-5.3-flash → image+video+pdf; uppercase `GLM-5.3` matches; glm-4v-flash → 16384+image), discovery parser legacy-mirror + hint-merge units. E2E — wizard save without pressing the button still persists models and the gate stays closed after reload. Manual — real zai/bigmodel key end-to-end (glm-5.3 1M ctx; flash vision), Ollama keyless discover, settings discover merge.

### P1.2 — GLM vision over-application fix → **alpha.6** (done; merge `9821744`, release `c49c962`)

User report on alpha.5: context lengths correct (glm-5.2+ = 1M ✓) but ALL glm models showed as
vision; ground truth = only the glm-5.3-flash family (incl. flashx) is vision. Root causes
(source-verified + reviewer-simulated on the real resolver): (1) two upstream
**vendor anthropic inputFormat site rules** (`api.z.ai`/`open.bigmodel.cn` `/api/anthropic`,
modelMatch `.*`, `inputFormat{image,video:true}`) — "endpoint accepts image blocks" conflated
with per-model vision; providerSiteRules flatten AFTER modelRules and later-defined fields win,
so they blanket-overrode every per-model `image:false` on anthropic-flavor providers (latent
upstream bug; openai-compat flavor has no site rules and was already correct). (2) The
flash-family vision overlay missed `glm-5.3-flashx` (suffix letter without separator) — masked
by (1). Fix (data-only): delete the two site rules (midConversationSystem endpoint rules kept);
extend the overlay in place to `(?:x)?`; resolver regression tests on both flavors (glm-5.3
image false + 1M; flash + flashx vision; unrated models default non-vision) + catalog-level
guard (no vendor anthropic site rule carries inputFormat). Catalog revision stays 30
(appVersion-scoped active cache; same-revision conflict → bundled wins). Legacy V-suffixed
vision rules (glm-5v-turbo, glm-4.xv) predate the current 11-model lineup and are name-correct.

### P3 — Services purge + off-peak local backend → **alpha.7** (done)

Delivered on `agent/coder/vendor-purge-p3` (merge `b508f3c`, release `020f430`, tag `v3.14.3-alpha.7`, Actions run + `ZCode-3.14.3-alpha.7-win-x64.exe` verified; release notes carry the tasks-DB-reset / share-broken / off-peak-semantics warnings) — S0 specs+free-deletes → S2 usage split → S1 off-peak rebuild → C1 OAuth+dormant user → C2 billing/webview → C3 official-MCP+image-search unpin → C4 family/specs+settings de-plan → C5 config-fetches/remote-catalog → S4 sweep → [ulw] review round (RA GO-WITH-FIXES / RB GO / RC GO-WITH-FIXES; fixes applied once + full gates re-run): OAuth/account/entitlement middle-tier fully deleted (services oauth 16 files, web auth 7, coding-plan-subscription, bigmodel quota chain, accountProvider* family, official-MCP host+CLI chain, clientConfigService + remote builtin-catalog download, PayPal/webview chain, desktopOAuthDeepLink split); `usage-stats.ts` split (AppUsage rehomed; `IUsageStatsService` = app-snapshot only); off-peak rebuilt local (window-only admission in main via correlated scheduler request + window-open wake, Run-now, hands-off auto-decline for permission/AskUserQuestion/plan-approval, persisted model_selection dispatch, 6 ticket columns hard-cut, scheduler port-injection harness, tool default build); dormant user framework (`UserInfo`→`user.ts`, `DEFAULT_LOCAL_USER {id:"user"}` auto-registered, all user UI unrendered, questionnaire re-triggers once); settings provider page de-planned (plain preset+custom; ~556/514 i18n lines dropped/locale); dead CLI auth trio + slash-login help pulled forward from P4. Key files: `specs/off-peak-local-admission.md`, `specs/account-services-purge.md`, `packages/shared/src/off-peak-window.ts`, `packages/services/src/session/offPeak*`, `packages/desktop/src/scheduler/schedulerRuntime.ts`, `packages/ui/src/store/index.ts`(DEFAULT_LOCAL_USER). Reviewer-flagged P4 carryovers: streaming-recovery 3008-3010 cluster (delete, don't rename — numeric-only match can misclassify personal bigmodel keys),`app-submit.ts`login regex, CLI`shared-credentials.ts`vendor key constants,`ModelRequestAuth` inert chain. Effort: delivered ≈ 6 focused sessions (vs 13–19 d estimate — worker delegation + dead-at-the-gate off-peak de-risked S1).

**Amendments (P3, in-phase; investigation- and review-driven; user rulings 2026-09-27):**

- **A6 (P3)** Web conversation-share landing is compile-coupled to vendor web OAuth (`web/main.tsx` imports `web/src/auth/**`): P3 deletes the web login + landing owner-login; public viewing stays; desktop share publishing stays compiled but runtime-broken until P5 item 4 (documented known issue).
- **A7 (P3)** `shared/src/usage-stats.ts` is split, not deleted: generic `AppUsage*` + `ESTIMATED_TOKEN_CHAR_DIVISOR` rehome (protocol/v4-transport/CLI/UI import them); `IUsageStatsService` keeps `getAppUsageSnapshot` only.
- **A8 (P3)** CLI is compile-coupled to the A1-protected account schemas today (`ZCodeProviderAccountAccess` ×3 files, `BUILTIN_MODEL_PROVIDER_IDS` in reasoning-history-normalization, offpeak retry/requestAuth paths, official-mcp port): those CLI edits land in P3's same commits; the already-dead vendor auth trio (`cli-oauth.ts`, `bigmodel-oauth.ts`, `coding-plan-api-key.ts`) is pulled forward from P4 so the bigmodel endpoint builders can be trimmed.
- **A9 (P3)** All vendor `/api/v1/client/configs` consumers die in P3 (off-peak gray, dynamicWorkflow gray → local constant OFF, context-prompt rollout → local default, plugin-store order → bundled) plus the remote builtin-catalog download (`zcode-builtin-download.ts` chain → bundled fallback); `clientConfigService` dies with them.
- **A10 (P3)** `desktopOAuthDeepLink.ts` splits: OAuth state/callback machinery dies; generic workspace deep-link machinery (incl. P5 share-import delivery) moves to a neutral module. Preload/channels OAuth IPC + `IPlatformService` OAuth methods die with it.
- **A11 (P3)** image-search removed from the pinned default-enabled plugin list (host auth resolver death makes it permanently failing); plugin definition cleanup stays in P5 item 3.
- **A12 (P3)** Off-peak local admission = **time-window only** (default 00:00–07:00, disable-able) + "Run now" override; idle and AC-power detection considered and REJECTED (user ruling 1). Admission evaluated at claim time by the scheduler (main-process evaluator via correlated scheduler-protocol request; window-open wake timer). Ticket columns hard-cut (`schedulable` concept becomes claim-time). See `specs/off-peak-local-admission.md`.
- **A13 (P3)** Off-peak runs are always hands-off: permission / AskUserQuestion / plan-approval interactions auto-declined while the off-peak turn is the session's active turn; no presence detection; `OffPeakCreate` tool default `yolo` → `build`. Rationale recorded in the spec (user ruling 2: policy approved, rationale must be documented).
- **A14 (P3)** User framework kept **dormant** (user ruling 6): `UserInfo` relocated to `shared/src/user.ts`; store keeps `user/setUser/authSessionSeq`; one hidden local user `user` auto-registered at startup; all user UI unrendered (incl. `handleLogout` chain); occupation questionnaire re-triggers once for existing alpha users (accepted, documented). Revival = replace the initializer.
- Free deletes verified + delivered in S0: `plan-identity.ts`, `provider-family-connection-selection.ts`, `account-provider-state.ts`, dead `provider/updateAccountConfig` wire (schemas + method id), `resolveRuntimeProductEndpointConfig`; `ForceUpdateConfig` inlined into `forceUpdate.ts`. `.env.example` ZAI/BIGMODEL platform vars are trimmed in the domain commits where their last readers die (C1/C4), not at S0.

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

### P4 — CLI runtime: rename + WebSearch removal → **alpha.8** (done)

Delivered on `agent/coder/vendor-purge-p4` (6 commits + review-fix commit, merge `ea7c61b`; ~180 files, net ≈ −3.1k lines): **B** WebSearch + `supportsNativeWebSearch` + `providerNative` mechanism fully excised (handler/contract files + barrels/subpath export, tool-transform anthropic branch, exposure gate, required schema field across shared/provider/prompt-trajectory, every name-keyed list, identity-mapped telemetry pair, UI metadata editor + i18n + NOTICE row; kept `webSearchRequests` accounting + `"search"` family + embedded-search); **C** official coding-plan gateway deleted (direct connect for zai/bigmodel templates; proxy/CA semantics preserved via instance-level memo — review fix), start-plan 3008-3010 cluster DELETED per P3 ruling (streaming-recovery, turn-model-step admission branch, target-verifier retry, failure-code entries → generic 429 path; UI entries + i18n 3008/3009/3010/3102 + dead team-plan code), `OffpeakQueued` + 6 consumers dead-deleted (replay-safe, raw-code rendering documented), `ModelRequestAuth` inert chain deleted end-to-end (contracts/core/adapters/bootstrap/protocol + host fast-fail; session-title dead deferral gate removed), phase-3 residue (login regexes, slash login/logout members + argv routing, shared-credentials vendor parts, account-plan branch, bracketed-code parser neutral rename); **D** `glm`→`zcode` rename (both provider literals one commit, event/type names, `ZCODE_AGENT_PROVIDER`, `X-ZCode-Agent: zcode` + Referer→repo URL, `GLM_BINARY_PATH`→`ZCODE_AGENT_BINARY_PATH` + dir `glm/`→`zcode/` descriptor-driven incl. desktop env writer + packaging/locks/4 staging scripts with nonReusableReleaseAssetIds carrying old+new ids, skill prefix `glm:`→`zcode:` atomic with UI contract test, icons renamed + orphan deleted + inventory regen, literal sites hard-cut per Ruling 1 with 中文注释); **E** themes `zai-*`→`zcode-*` (93 refs/23 files) + WebFetch UA→repo URL + 4 comment neutralizations. **Review round:** RA GO-WITH-FIXES / RB GO-WITH-FIXES / RC GO; fixes applied once (durable theme reset — pre-hydration readers validate + write-back; proxy/CA memo; stale comments; spec amendments A-P4.1 test descope to source-scan guards + descriptor invariants, A-P4.2 accepted degradations, A-P4.3) and ALL gates re-run. Tests: shared 15 / services 75 / ui 25 / desktop 7 / e2e 10 all green; knip zero new entries (set-diff vs branch point); `pnpm smoke:windows-bundle` PASSED (packaging chain replicated with `zcode/` resource dir; exe 141.1 MiB). Spec: `specs/agent-identity-and-tooling-purge.md` (rulings 1-8 recorded; Ruling 2 hardened to no config normalization per user). User rulings 2026-09-28: hard cut for old glm data AND configs (dev-first); delete ModelRequestAuth/providerNative/OffpeakQueued; headers/themes/codes as recommended.

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

### P5 — Infrastructure re-pointing → **alpha.9** (done)

Delivered on `agent/coder/vendor-purge-p5` (merge `ca30f8c`, release `37c9c62`, tag `v3.14.3-alpha.9`; Actions both jobs green — Windows installer 9m57s + NEW linux remote-assets job 3m6s; Release carries exe + latest.yml + blockmap + 4 manifests + 24 flat components; libre marketplace repo `github.com/yeyuan98/zcode-plugins` published live with 9 plugins + v1.0.0 zips). **A — updater**: electron-updater github provider; `--publish never` added to bundle.mjs (RA blocker: explicit github publish config + CI tag ⇒ implicit onTag publish throws without GH_TOKEN — smoke now reproduces the CI-tag env); single `latest.yml` channel; `allowPrerelease` floor rule (`resolveAutoUpdaterAllowPrerelease` = previews-on OR prerelease current version — never below ctor default, else `/releases/latest` 404s pre-final); `zcodeReleaseChannel` stale-guard + channel nesting deleted; all three P0 paths re-enabled (production-flavor gate kept; refresh path gained the flavor latch at review); `ZCODE_UPDATE_FEED_URL` honored in packaged builds as generic-provider mirror base (no query mutation); force-update chain fully deleted (~1,300 ln); source-scan + runtime unit tests replace updateFeedPolicy.test. **B — remote assets**: default base `github.com/yeyuan98/ZCode/releases/download/v<ver>`; flat names `zcode-remote-<id>-<pa>-<versionToken>-<sha12>.tar.gz` (`-`-joined; `+` only in manifest JSON); `v<version>`-tail detection ⇒ exactly ONE url per asset (no nested/components-root probing; mirrors keep pinned/unpinned nested candidates, v-prefix aware); producer flat-staging mode (`ZCODE_REMOTE_ASSET_FLAT_STAGING_DIR`) emits upload set while nested dev mock-cdn preserved; `__ZCODE_CDN_BASE_URL__` define dropped; new packages/server test harness + builder tests. **C — marketplace**: official = bundled-only (browser-use + node-repl-host); phantom definitions pruned (sources never open — CDN probe proved zips 404; quartet upstream anthropics/skills is Proprietary ⇒ unlawful to re-vendor); NEW first-party libre marketplace `zcode-plugins-libre` @ `yeyuan98/zcode-plugins` (raw.githubusercontent catalog, Release-asset zips + sha256, pre-registered default, zero default-enabled, 9 plugins: skill-creator re-sourced Apache-2.0 + 8 licensed wrappers with full license texts + dual-credit provenance); reserved-id set {official, libre}; legacy known_marketplaces vendor-source records inert (3-layer guard); `requiresPaidPlan` chain (~10 sites) + Featured mechanism deleted; the previously-FICTIONAL parity test authored for real; auto-refresh retargets source-ful defaults. **D — share→export**: vendor chain deleted (~7,800 ln + 165 i18n keys ×2 incl. web landing + deep link + last `zcodejwttoken` readers); protocol import schemas kept decode-only; `IConversationExportService` built (whole-session markdown, in-flight guard, subagent/hookInvocation-rendering formatter, connection-scope factory at 4 exposure sites, web Blob saveFile fallback with deferred revoke). **E — identity/endpoint web**: builder identity → repo/noreply; services `app.zcode.server*` + stale-alias sweep on register (review fix); Help-menu endpoint selector + `zcodeEndpointOrigin` setting + agent env injection + `zcodeEndpoint.ts` itself DELETED (zero survivors); clientScenes chain (last live `{ZCODE}` API consumer) deleted — automation templates/scene suggestion chips degrade away (no bundled replacement, documented); changelog/arch-guard links → repo Releases. Review round RA/RB/RC GO-WITH-FIXES; fixes applied once + ALL gates re-run. **Amendments A-P5.1–8**: (1) e2e export smoke descoped to manual QA (mock provider can't produce a completed turn); (2) export input shape workspace-scoped + result carries fileName; (3) `formatSharedContextV1`→`formatConversationExportV1` replaced in place; (4) `conversation_running` error kind + cross-RPC reader; (5) connection-scope factory slim rebuild; (6) no desktop-attached-remote gating for export; (7) selectRows v2 seed dropped at review (knip); (8) libre set = skill-creator + 8 wrappers (finance/video/mimosa/github-wrapper excluded on license/coupling; documents quartet legally impossible — clean-room track post-P5). P4-review carryovers (`filterSkillsForProvider` param, `settings.memory.viewer.disabled` orphan) still deferred to P6.

**Changes:**

1. **Auto-update → electron-updater GitHub provider:** `.github/workflows/release-desktop.yml` uploads `latest.yml` + `.exe.blockmap` (+ `beta.yml` if preview channel kept, mapped to `allowPrerelease`); `publish: {provider:"github", owner, repo}` in `electron-builder.config.js` (replacing the localhost generic placeholder + `dev-app-update.yml`); delete `ManifestUpdateProvider` + force-update gate; rework stable/preview channel UI logic to the GitHub model; **re-enable the three P0 update paths** (guard was provider-keyed so alpha→alpha updates now work — first real in-app alpha→alpha verification happens at A10, since A1–A9 builds all carry the disabled updater); **make the mirror override real**: `ZCODE_UPDATE_FEED_URL` is currently ignored in packaged builds (`autoUpdater.ts:703-710` `isPackaged` guard; NOTICE.md:49) — remove that guard so it becomes a genuine runtime mirror escape hatch (CN reachability), and update NOTICE.md. `pnpm smoke:windows-bundle` before pushing workflow changes (mandatory per AGENTS.md).
2. **Remote assets → GitHub Releases:** flat-named per-version-tag assets (`zcode-linux-x64.tar.gz`, `manifest-linux-x64.json`, node/node-pty per-platform components); rework URL builders — desktop `remoteCdn.ts:29-31` hardcoded `/zcode/electron/releases/<v>` suffix and server `remoteAssetCdn.ts` nested-path candidate builders; collapse 404-probe candidates (GitHub unauthenticated rate limit 60 req/hr/IP); keep runtime overrides for self-host/mirrors — note `ZCODE_CDN_BASE_URL` is currently a **build-time** define (`desktop/tsup.config.ts:112`), so `ZCODE_REMOTE_ASSET_CDN_BASE_URL` (runtime) is the user-facing mirror knob, or make `ZCODE_CDN_BASE_URL` runtime-resolved; document mirror guidance. Note: per-remote-platform node binaries cannot be bundled into one installer — GitHub Releases (or mirror) is the complete solution.
3. **Plugin marketplace:** remove official CDN default + `ZAI_AUTHOR` + `OFFICIAL_PLUGIN_ASSETS_BASE_URL` (`official-plugin-definitions.ts:57-58`); store = repo-bundled plugins + Personal Sources (git/URL/local — already supported); default marketplace source configurable; drop image-search plugin (vendor MCP); fix pinned-list bootstrap test (`plugin-marketplaces.ts` parity comment); update CONTEXT.md concepts (Official Marketplace/CDN/Featured).
4. **Conversation share → local export only:** delete `conversationShareService.ts` publish path, web landing page, `zcode://share/import`; **build** local markdown session export (net-new; reuse share turn-serialization concepts).
5. **Identity:** `electron-builder.config.js` homepage/author/maintainer → repo values; service names → `app.zcode.server`; WebFetch UA URL neutral; vendor logos removed from `model-provider-logo-sources.json` registry (zai/bigmodel logos stay as ordinary provider icons).

**Why / consequence / UX / alternative:**

- _Why:_ distribution must not depend on vendor API/CDN.
- _Consequence:_ update chain self-owned (GitHub Releases, MIT-licensed electron-updater native flow); asset publication workflow is new; share hosting gone.
- _UX degradation:_ update UX equivalent (native updater flow, now from GitHub; CN users may need the feed override/mirror — documented); conversation share becomes local export (accepted, D3).
- _OSS alternative:_ GitHub Releases (standard OSS distribution); generic provider for fully self-hosted update feeds; any static host for assets via env overrides.

**Tests/QA:** unit — URL builders produce flat GitHub asset URLs; updater parses `latest.yml`; feed override honored in packaged builds. Integration — `ZCODE_AUTO_UPDATE_DEV` loop against fixture feed. `pnpm smoke:windows-bundle`. Manual — install A9 over A8 manually (updater disabled on A1–A8 by design); verify in-app update machinery against the dev fixture feed; remote SSH workspace downloads assets from GitHub Releases; overrides work. Real in-app alpha→alpha update is verified at A10 (A9→A10).

### P6 — Cleanup, sweep gate, RC → **alpha.10** (RC) — final 3.14.3 moved to a separate session

**P6 user directives (2026-09-28, binding; spec of record `specs/vendor-free-gate-and-ci.md`):**
(1) gate matches ONLY the five fool-proof patterns `zcode\.z\.ai|cdn-zcode|chat\.z\.ai|zhipu-account|com\.zhipu` — `glm` deliberately NOT matched (legit model family + provider icon literal; allowlist collapses to 3 negative-assertion tests); (2) "just in case" legacy structures are DELETED outright (alpha cleanliness ruling; `desktopDeviceMid.ts` gets a stale-comment fix only, deletion assessed separately); (3) docs carry NO search/SearXNG guidance — root READMEs are succinct quickstarts pointing to a new `docs/` folder whose module docs start simple and end with API references; (4) the final non-prerelease 3.14.3 is OUT of P6 scope (separate session inherits the alpha.10→3.14.3 in-app update proof and the §5 final step).

**Changes:**

1. `scripts/check-vendor-free.mjs` — zero-hit gate for the five patterns above (case-insensitive); exclusions: CHANGELOG.md + VENDOR-PURGE-PLAN.md + specs/ (audit docs) + binary-by-extension skip; allowlist: 3 negative-assertion test files with per-entry reasons. Wired into `verify:pre-push` **and a new PR CI workflow** (none exists today — net-new deliverable; lint + architecture check + tests + vendor-free gate).
2. Third-party notices regen incl. `third-party/inventory.json` (verify + full resync; ARMS/swr entries already absent).
3. Docs: `.env.example` final trim (+ add missing live `ZCODE_UPDATE_FEED_URL`), AGENTS.md/CONTEXT.md verify, README/README.en.md rewritten as succinct quickstarts + new `docs/{providers,updates,plugins}.md` (Ollama template; vLLM as OpenAI-compatible custom provider; mirror env vars; NO search guidance).
4. Full dogfood pass of the RC; release alpha.10 per §5 (first real in-app update proof alpha.9→alpha.10).

**Delivered on `agent/coder/vendor-purge-p6` (merge `399c4cc`, release `aafb1ea`, tag `v3.14.3-alpha.10`; Actions: Release Desktop both jobs green 12m18s + FIRST CI run green on follow-up `fac9824` after the CLI-job fix; Release assets verified 31 = exe + latest.yml + blockmap + 4 manifests + 24 remote tars; [ulw] RA/RB/RC round = GO/GO/GO-WITH-FIXES, fixes applied once + full gate re-run).** Gate = 5 patterns (no glm per user directive), 3-entry negative-assertion allowlist, self-exclusion; exclusions CHANGELOG/plan/specs/gate-self only (lockfiles/binary/.agents/third-party zero-hit, no rules needed). Sweep: productDocs URL → repo README; both-strings decode dropped (A-P6 amendment; services sqlite test pins the dead-providerId breakage); dead `_legacyProvider` param + 3 orphan locale keys (`settings.memory.viewer.disabled`, `presetDescription` pair, `namePlaceholder` pair) deleted; zh copy neutralized (placeholder/title/presetEmpty OAuth wording); ~8 comment rewords + deviceMid comment-only fix (module kept per user); cli build.mjs tombstone trimmed. Legacy deletions: builtinSkillI18n markers/descriptions for P5-deleted plugins (superpowers + browser-use kept); marketplace strict loading (shape validation + reserved-id disk contract in shared, array-only container, adapter refresh branch = bundled-no-network; pre-P5 records dropped + re-seeded). Docs: succinct README(.en) + `docs/{providers,updates,plugins,development,packaging}.md`; no search guidance; `.env.example` +ZCODE_UPDATE_FEED_URL; config/default.json en community → Discussions; inherited Feishu/Discord links removed. Notices resync (2 expected hash updates; 3 orphan @arms evidence files deleted). CI = 5 jobs; **lesson**: CLI packages live in the ROOT workspace (pnpm-workspace.yaml includes apps/zcode-cli/packages/\*); the CLI's own workspace/lockfile is vestigial and cannot fresh-install (pre-existing, documented in handoff — CI CLI job mirrors local flow: root install + turbo PATH). Manual QA pending on Windows: **A9→A10 in-app update proof (headline)**, off-peak fresh-install (A7 carryover), MCP search spot-check (A8 carryover).

**Why / consequence / UX / alternative:**

- _Why:_ guarantee no vendor residue ships in the final build; establish permanent regression gates.
- _Consequence:_ new CI workflow + lint gate are net-new maintenance surface.
- _UX degradation:_ none — cleaner docs and onboarding guidance (Ollama/vLLM, MCP search, mirrors).
- _OSS alternative:_ n/a (gate itself enforces the OSS posture).

**Tests/QA:** full matrix re-run on the RC build + final; in-app update to final verified from A9/A10 lineage (A1–A8 lineages upgrade via manual installer — updater intentionally disabled until P5).

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
2. **Per alpha (A1..A10):** `pnpm release --increment=3.14.3-alpha.<N> --ci` — always preceded by a dry check: `pnpm release --increment=3.14.3-alpha.<N> --ci --release-version` (prints target, exits; catches mis-resolution). Tag `v3.14.3-alpha.N` pushes trigger `release-desktop.yml`.
3. **Workflow tweak:** add `prerelease: ${{ contains(github.ref_name, '-') }}` to the softprops step.
4. **Final:** `pnpm release --increment=3.14.3 --ci --release-version` (verify `3.14.3`) then execute → exact `3.14.3`, non-prerelease Release.
5. **Changelog:** default behavior — each alpha gets its own entry (alpha.1's entry spans full history because no tags remain — one-time blob, optionally pruned in a follow-up docs commit); final entry = commits since alpha.10. `--git.tagExclude='*[-]*'` on final would span full history instead — not recommended.
6. CLI/agent-internal versions unchanged.

---

## 6. Per-phase vetting gates (mandatory)

Every phase, before its alpha tag:

```
pnpm typecheck && pnpm lint && pnpm fmt:check && pnpm architecture:check --changed && pnpm knip
node --test (per-package test suites — see below)
pnpm smoke:windows-bundle   # required at A8 and A9 (packaging/workflow changes); Docker + 15 GiB disk
```

Manual: fresh Windows install of the alpha + upgrade from the previous alpha; phase-specific checks per §4.

**Test infrastructure (net-new deliverables, created where first needed):**

- Add `"test": "node --test test/"` scripts to `packages/services`, `packages/ui`, and each package gaining tests (Node 24 runs `.ts` natively; node:test + node:assert/strict — matches the existing 4 test files: services ×3, ui ×1).
- Electron-main integration harness (P0 network-assert, P3 scheduler round-trip) — explicit deliverable.
- Wizard E2E (P2) — explicit deliverable.
- New PR CI workflow (P6): lint + architecture check + all test suites + vendor-free gate.

**Matrix summary:**

| Alpha | Phase     | Key automated checks                                                                                                                                                                                                                      | Key manual checks                                                                                                                                                                                        |
| ----- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1    | P0        | telemetry no-op units; updater-guard units                                                                                                                                                                                                | no vendor telemetry/update traffic on fresh install; updates disabled (help-config fetch on user action remains until P2/P3)                                                                             |
| A2    | P2        | gate/wizard units; wizard E2E (new harness) — delivered: ui 20 + shared 9 unit tests, 8 e2e specs; all-lint-zero bonus                                                                                                                    | first-run wizard with real key + Ollama; `/remote` token login                                                                                                                                           |
| A3    | P2 hotfix | wizard layout regression locks (wizard-scroll.spec)                                                                                                                                                                                       | alpha.3 wizard layout on user machines (shipped 2026-09-26)                                                                                                                                              |
| A4    | P1        | catalog/schema units; discovery client units (mocked) — delivered: services 28, e2e 9                                                                                                                                                     | discovery with real key + Ollama; no GLM rules; wizard-complete⇒usable                                                                                                                                   |
| A5    | P1.1      | catalog glm-scope units (null-modelMatch walk) + GLM capability resolver units; discovery parser units (legacy camelCase mirrors, hint merge)                                                                                             | bigmodel/zai wizard end-to-end (glm-5.3 1M ctx; flash vision); Ollama keyless discover; settings discover merge                                                                                          |
| A6    | P1.2      | resolver vision matrix both flavors + catalog inputFormat guard                                                                                                                                                                           | glm-5.3 non-vision/1M; flash+flashx vision; both flavors                                                                                                                                                 |
| A7    | P3        | off-peak local backend units+integration (new harness) — delivered: services 74, desktop 7 (scheduler harness + auto-decline wiring), shared 9, ui 24, e2e 10/10                                                                          | off-peak runs locally; plan/quota UI gone; IM bots work (manual desktop pass still pending — run on a fresh alpha.7 install before relying on off-peak)                                                  |
| A8    | P4        | rename/protocol/tool-registry units; binary-resolution units; **smoke** — delivered: shared 15 (identity invariants, protocol purge guard, tool identity), ui 25 (skill prefix contract), services 75, desktop 7, e2e 10/10; smoke PASSED | agent spawn on installer; no WebSearch; MCP search spot-check (manual pass pending — run on a fresh alpha.8 install)                                                                                     |
| A9    | P5        | URL-builder/updater units; dev update loop; **smoke** — delivered: shared 21, ui 25, services 87, desktop 22, server 8 (new harness), scripts 7; smoke PASSED (incl. CI-tag env + --publish never path)                                   | install A9 over A8 manually; update machinery via fixture feed; remote assets from GitHub; overrides work — Actions + assets verified (exe/latest.yml/blockmap/24+4); in-app A9→A10 proof lands with A10 |
| A10   | P6        | vendor-free gate in new CI; full suites — delivered: gate 0-hit, CI 5/5 green (fac9824), suites shared 26/ui 26/services 91/desktop 22/server 8/scripts 14, e2e 10/10; smoke PASSED pre-push                                              | full dogfood RC pass; real in-app update A9→A10 — **PENDING (manual, Windows)**; A7 off-peak + A8 MCP-search carryovers pending                                                                          |
| Final | —         | full matrix re-run                                                                                                                                                                                                                        | in-app update A9/A10→final; A1–A8 manual-installer upgrade                                                                                                                                               |

---

## 7. Effort estimate

| Item                                                                    | Estimate                  |
| ----------------------------------------------------------------------- | ------------------------- |
| P0 (incl. 3 updater guards)                                             | 3–5 d                     |
| P2 onboarding wizard + gate                                             | 5–8 d                     |
| P1 excision + auto-discovery + Ollama template                          | 7–11 d                    |
| P3 deletions + off-peak local backend (delivered in ~6 worker sessions) | 13–19 d (est.)            |
| P4 rename + WebSearch removal                                           | 4–6 d                     |
| P5 update/assets/marketplace/share-export/identity                      | 9–12 d                    |
| P6 sweep gate + CI workflow + docs + notices                            | 3–4 d                     |
| Versioning/QA overlay (test scripts, harnesses, release dry-runs)       | 3–4 d                     |
| **Total**                                                               | **≈ 7–10 engineer-weeks** |

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
