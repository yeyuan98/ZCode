# Spec: Onboarding & Gate Policy (libre-zcode P2)

Status: implemented-by P2 (`v3.14.3-alpha.2`), wizard layout/header contract refined by the `v3.14.3-alpha.3` hotfix. Owners: UI root (`packages/ui/src/Root.tsx`, `root/useProviderAvailabilityLoginEntryGuard.ts`), provider settings facade (`packages/services/src/model-provider/`), web entry (`packages/web/src/`).

## Behavior

1. **Startup gate = provider availability only.** The app opens the welcome wizard iff
   `!hasUsableProvider && !onboardingDismissed`. `hasUsableProvider` keeps its current registry
   semantics (`resolveProviderAvailabilityState`: ≥1 non-hidden provider with ≥1 usable model).
   The `providerFamilyDomain` setting is no longer read or written on the startup path (field
   deletion happens in P1). The old `user` (vendor OAuth) term is dropped — per the alpha policy
   a restoring alpha.1 OAuth user may see the wizard briefly; the wizard auto-closes as soon as a
   usable provider appears (see invariants).
2. **Wizard replaces the vendor login screen.** The OAuth panel (Z.AI/BigModel buttons,
   auto-start, `useOAuth`) is deleted. Wizard flow: pick template (full builtin catalog — all
   vendors equal — plus custom card) → paste API key (+ provider's key-management link) →
   optional "test key" probe → save (create personal provider + default model preference) →
   auto-close. Custom path: base URL + key (OpenAI-compatible), UI hint for local models
   (`http://localhost:11434/v1`; builtin Ollama template lands in P1). **Skip** persists
   `providerOnboardingDismissedAt`; the wizard stays reachable via the Settings login entry
   (reason `manual-login`) and all existing open reasons.
   **Layout/header contract (alpha.3):** fullscreen shell follows the OccupationOnboarding
   idiom — drag-bar `pt-12` clearance, optional `DesktopWindowControls` on Win/Linux, card
   capped at viewport height with the step header pinned above an in-card scrollable body
   (the header must NEVER scroll away or clip); headers are step-aware — key step shows the
   chosen provider's name/logo/provider-specific description, never the generic "pick a
   provider" copy. Locked by `e2e/wizard-scroll.spec.ts` + the provider-heading assertion in
   `e2e/wizard.spec.ts`.
3. **Test-key probe = direct HTTP from the services layer.** A new provider-facade method calls
   the template protocol's model-list endpoint (`GET {baseUrl}/v1/models`; `Authorization:
Bearer` for openai-compatible, `x-api-key` + `anthropic-version` for anthropic-compatible)
   through the host network transport (proxy settings honored). It never spawns the agent
   runtime; the settings-page agent-based connectivity test is unchanged; P1's discovery client
   supersedes this probe.
4. **Self-hosted web login = token.** `packages/web` gains a same-origin login page shown when
   the server enforces auth: enter the server token (origin pre-filled, editable address for a
   different instance). Verification: fetch a token-protected endpoint with `?token=` (success
   sets the `zcode_lite_token` cookie server-side; 401 = wrong token) then boot. Login decisions
   are made ONLY from fetch status codes (browser WebSocket errors carry no status); a server
   started without `ZCODE_SERVER_AUTH_TOKEN` shows no login at all. Vendor OAuth for web is
   deleted in P3.
5. **Feedback = GitHub Issues (external).** All feedback entries open
   `https://github.com/yeyuan98/ZCode/issues/new` with context (error text / task id)
   URL-prefilled in `title`/`body`. The in-app feedback center (UI, service interface, vendor
   HTTP client, local ticket store, device-id plumbing) is deleted. Community: zh-CN →
   `https://github.com/yeyuan98/ZCode/discussions`; en-US Discord unchanged. Help config
   (feedback/community URLs) resolves from the local `config/default.json` only — the remote
   `/api/v1/client/configs` help-config fetch is removed (the remaining client-config consumer,
   the main-process context-prompt rollout, is P3 scope).

## Ownership & invariants

- Gate decision is owned by `useProviderAvailabilityLoginEntryGuard` (single place; entry points
  must not re-implement). It evaluates once per startup **after both** (a) the model-selection
  view hydrates (or errors) and (b) app settings hydrate — the dismissal flag lives in settings,
  so evaluating before settings load would false-open for dismissed users.
- `onboardingDismissedAt` is an **optional** AppSettings field (`providerOnboardingDismissedAt`,
  ISO string). Optional is mandatory: settings load zod-parses leniently and silently falls back
  to defaults on failure — a required new field would factory-reset settings for existing users.
- Wizard open/close events: open = gate startup check | `manual-login` | `provider-request` |
  `logout-provider-required` | `session-expired`; close = usable provider appears (auto) | user
  completes wizard | user skips. Auto-close on availability is new behavior and must exist,
  because the one-shot guard never re-runs and previously only the (deleted) OAuth `user` signal
  closed the screen.
- The coding-plan Connect/Upgrade entries are intentionally untouched (P1 compile-removes them);
  during alpha.2 they may open the wizard without starting OAuth — accepted dead-end per alpha
  policy (no crash; pending upgrade-login state is inert).
- Web login must never create a redirect loop: only fetch-status-based decisions; WS failures
  surface the existing bootstrap error UI.

```
startup: settings.hydrated ─┐
                            ├─> guard (one-shot) ── open wizard ──> modelSelectionView.onDidChange
modelSelectionView ─────────┘        │ close: hasUsableProvider │       (hasUsableProvider ⇒ auto-close)
                                     │ skip: write providerOnboardingDismissedAt
                                     └ re-open: manual-login / provider-request / session-expired
```

## Migration boundary

Fresh start (alpha policy: no alpha→alpha compat). Known residuals for later phases: the
`providerFamilyDomain` field + its post-startup consumers (settings/sidebar/off-peak UI) die in
P1; OAuth services + coding-plan entries in P3; conversation-share token read
(`remoteWorkspaceServiceCollection.ts`, mislabeled "/remote login" in the master plan — it is
share-publish auth) in P5 with share itself.
