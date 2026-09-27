# Spec: Vendor Account Services Purge (libre-zcode P3)

Status: planned (P3). Owners: services assembly (`packages/services/src/node.ts` + per-service
modules); UI store/settings surfaces; desktop main (deep-link/webview/env); web shell
(`packages/web/src/main.tsx`).

## Behavior

P3 deletes the vendor account middle-tier in five domain-atomic commits (each compiles green;
services + shared types + UI + desktop/web + CLI-forced edits land together):

1. **Login/OAuth (C1).** `services/src/oauth/**` (16 files), `web/src/auth/**` (7 files),
   OAuth half of `desktopOAuthDeepLink.ts` (generic workspace deep-link machinery moves to a
   neutral module and survives), preload/channels OAuth IPC + `IPlatformService`
   registerOAuthState/onOAuthCallback + `ServiceChannels.OAuth`, token-refresh /
   cached-session-restore / polling hooks, the store's OAuth-session field cluster
   (`isRestoringOAuthSession`, `oauthError`, `oauthPollingActive`, `oauthSuccessSeq`,
   `lastOAuthSuccessProvider`/`markOAuthSuccess`, `initialIsRestoringOAuthSession` option
   threading), `useRootWorkspaceActions.handleLogout` + footer `onLogin/onLogout` prop chain,
   `shared/src/oauth.ts` (after relocating `UserInfo`), `shared/src/coding-plan-reset.ts`,
   `providerProvisioningSource.ts` OAuth key-name exports. Web share landing loses its
   login button (public viewing stays; `main.tsx` rewired). Generic credential store,
   third-party MCP OAuth, IM-bot webhooks, and the provider-wizard `requestLoginEntry` stay.
2. **Billing/quota (C2).** `coding-plan-subscription/**` (4 files),
   `bigmodel/{teamPlanApiKey,codingPlanEntitlement}.ts`,
   `model-provider/{zaiStartPlanBilling,accountProviderApiClient,accountProviderApiTypes,accountProviderRequestAuthService,accountProviderTeamPlanRequestKey}.ts`
   (+ Credential\* siblings iff knip-orphaned), the PayPal/coding-plan webview navigation
   chain in `desktopWindowChrome.ts` / `desktopMainIpcRemote.ts` + preload +
   `CodingPlanEmbeddedWebviewDialog` chain + `rendererZCodeEndpoint.ts`,
   `shared/src/coding-plan-subscription.ts` (ForceUpdateConfig already inlined in S0).
3. **Official MCP (C3).** `shared/src/official-mcp-auth.ts`, `services/src/official-mcp/*`,
   the `interaction/requestOfficialMcpAuthHeaders` protocol method + schemas + host handler,
   `zcodeMcpQuotaProvider.ts`, CLI asking code (`official-mcp-auth-port.ts`,
   `adapters/mcp/official-auth.ts`, `mcp/index.ts` wiring, `plugins/mcp.ts`,
   `zcode-protocol-entrypoint.ts`, `server.ts`), `official-mcp-tool-error.ts` + consumers
   (delete or per-symbol deferral with recorded reason), official members of
   `MCP_SERVER_FAILURE_KINDS`. image-search removed from the pinned default-enabled list.
4. **Family/specs + settings de-plan (C4).** `model-provider-family.ts`,
   `model-provider-types.ts` vendor ids/guards (KEEP `BUILTIN_PROVIDER_TEMPLATE_IDS`,
   `ModelConnectivityResult`), protocol account schemas (`:812-849`) + runtime-headers
   `accountAccess` branch, CLI forced edits (`invocation-context.ts`, `core/runtime/types.ts`,
   `runner-runtime.ts`, `reasoning-history-normalization.ts`), `rule-data-schema.ts` message
   reword, endpoint-helper trim per keep-list, the settings "connection mode"/plan cluster
   (ModelProviderSection, navigation, visibility, Detail, StatusCards, StartPlan*,
   CodingPlan* dialogs incl. the OAuth-sync callback at `ModelProviderSection.tsx:404-413`),
   neutral model-picker grouping, `startPlanRecommendationDismissed` setting, ~470
   i18n keys/locale.
5. **Vendor config fetches (C5).** `clientConfigService` vendor fetch +
   `desktopContextPromptRollout.ts` + dynamicWorkflow remote gate (local constant OFF) +
   plugin-store order (bundled) + remote builtin-catalog download (`zcode-builtin-download.ts`,
   `zcodeBuiltinRemoteConfig.ts`, CLI `process-provider-registry-runtime` → bundled fallback);
   full `IClientConfigService` registration/channel removal; CLI `dynamic-workflow-policy`
   gate → local source. Off-peak enablement is no longer remote-gated (see
   off-peak-local-admission spec).

Rulings recorded (2026-09-27): web-share login dies now with publishing broken-until-P5
(ruling 3); feature-flag fetches die with local fallbacks (ruling 4); image-search unpinned
(ruling 5); dormant user framework (ruling 6, below). Off-peak rulings live in
`specs/off-peak-local-admission.md`.

## Dormant user framework (ruling 6)

- The neutral identity type `UserInfo` (`{id, username, displayName, avatarUrl?}`) is
  relocated from `shared/src/oauth.ts` to `shared/src/user.ts` and **kept**; the store keeps
  `user` / `setUser` / `authSessionSeq` (increments only on null→user). A startup initializer
  (store-provider mount effect; covers desktop renderer and web) registers exactly one local
  user `DEFAULT_LOCAL_USER = {id: "user", username: "user", displayName: "User"}` whenever
  `user === null` — idempotent per start, no persistence, no UI surface.
- All user-visible user UI is removed from render (sidebar avatar/login block, logout menu).
  Logout is meaningless under a dormant single user; no replacement behavior.
- Accepted side effect (documented, no migration): the occupation questionnaire keys its
  shown-once record by user id (`useOnboardingTrigger`); with the built-in id `"user"`,
  existing alpha users see it one more time. Release notes state this.
- Revival path: re-introduce a real identity provider by replacing the initializer; the type
  and store plumbing survive untouched.

## Invariants & keep-traps

- Generic credential store (`credentialService`) survives (bots/webhooks; vendor mirror keys
  simply stop being written).
- Third-party MCP OAuth (protocol `zcodeProtocolMcpOAuthSchema`, `oauth_authorization_failed`)
  and `independentPlanState` are NOT vendor concepts — keep (P6 gate false-positive traps).
- Conversation-share `zcodejwttoken` read is a plain string constant and survives until P5
  removes share (workers must not pre-delete it).
- `ESTIMATED_TOKEN_CHAR_DIVISOR` + `AppUsage*` rehome to `shared/src/app-usage.ts` BEFORE the
  vendor half of `usage-stats.ts` dies (protocol + CLI + UI import them).
- `IUsageStatsService` keeps `getAppUsageSnapshot` only; sheds
  `isCodingPlanModelProviderId` / `IAccountRequestAuthService` / `OfficialMcpCredentialSource`
  imports in the same slice that deletes them.
- Endpoint-helper keep-list (until P4/P5): `resolveZCodeEndpointOrigin`,
  `resolveRuntimeZCodeEnv`, `resolveRuntimeZCodeEndpointOrigin`, `buildZCodeEndpointUrls`,
  `DEFAULT_ZCODE_ENDPOINT_ORIGIN`, `normalizeZCodeEndpointOrigin`, `rewriteZCodeEndpointUrl`,
  `pickProductEndpointEnv`/`readProductEndpointEnv`, `RuntimeZCodeEndpointEnv`.
- Deletion registration points updated per domain commit: `services/node.ts`,
  `services/index.ts`, `accessor.ts`, `client/remoteServiceAccess.ts`,
  `desktop/host/remoteWorkspaceServiceCollection.ts`, `channels.ts`.

## Migration boundary

Fresh start (no users outside alphas). Known accepted degradations on alpha.7: task database
reset required (see off-peak spec); share publishing broken + private-share viewing ends
until P5; dynamic workflow stays off; occupation questionnaire may re-appear once; `.env`
docs trimmed when each variable's last reader dies (ZAI*\* at C1, BIGMODEL*\* verified at C4).

## Expected-death list (summary)

Free deletes (S0): `plan-identity.ts`, `provider-family-connection-selection.ts`,
`account-provider-state.ts`, dead `provider/updateAccountConfig` wire (schemas + method id),
`resolveRuntimeProductEndpointConfig`. Domain lists per C1–C5 above; full file inventory in
the P3 execution record (VENDOR-PURGE-PLAN.md §4 P3 delivered-state, written at merge).
