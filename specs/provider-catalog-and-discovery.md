# Spec: Provider Catalog & Model Discovery (libre-zcode P1 + P1.1)

Status: implemented-by P1 (`v3.14.3-alpha.4`); P1.1 (`v3.14.3-alpha.5`) refines the catalog
invariant (A5 capability metadata), adds wizard auto-discover on save, settings-tab
per-provider discovery, and discovery parser hardening. Owners: provider catalog
(`config/provider/zcode-builtin.json` + `packages/provider/src/config/`), provider settings
facade (`packages/services/src/model-provider/`), wizard key step
(`packages/ui/src/login/LoginApiKeyForm.tsx`).

## Behavior

1. **Catalog = vendors as equals.** The builtin catalog contains 21 templates: 16 pre-existing
   generic templates, 4 vendor templates (`zai-api`, `zai-standard-api`, `bigmodel-api`,
   `bigmodel-standard-api`) as ordinary plain-`api-key` entries (de-branded names — no
   "Coding Plan"; key-management URLs kept), and a new `ollama` template
   (`openai-chat-completions`, `http://localhost:11434/v1`, **no access block** — the wizard
   skips the key step and discovery runs unauthenticated for localhost). Invariants:
   - Zero `account:*` providers, zero `zhipu-account`/`zhipu-coding-plan-api-key` access
     configs anywhere in the catalog.
   - **(P1.1 / decision A5)** `glm` (case-insensitive) may appear ONLY inside
     `modelConfigRules.modelRules` — model-id `modelMatch` patterns and their capability
     properties (contextWindow tiers, inputFormat overlays). Capability metadata for vendor
     model families is ordinary equal-vendor content: 61 equivalent rules for
     gpt/claude/kimi/deepseek/qwen/minimax/mimo/grok models survived P1; without restored GLM
     rules those models are the only metadata-less major family (verified live: bigmodel/zai
     listing endpoints return ids only on both api flavors). Everywhere else the catalog stays
     glm-free: vendor templates carry NO `builtinModelIds`; GLM ids stay stripped from generic
     aggregator templates (openrouter/opencode-go/opencode-zen — discovery/manual add covers
     them); `templateModelRules`/`builtinProviderModelRules` stay glm-free; the P6
     vendor-free gate allowlist gains exactly the modelRules-metadata class. The single `.*`
     default modelRule stays.
   - Zero `supportsNativeWebSearch` properties in the catalog (the WebSearch tool dies in P4;
     its catalog flags die now). Site rules keyed to `zcode.z.ai` platform URLs are deleted;
     capability metadata (inputFormat, supportsMidConversationSystem) for surviving vendor
     endpoints (`api.z.ai`, `open.bigmodel.cn`) and for deepseek/anthropic stays.
   - The catalog keeps ≥1 plain-`api-key` + `openai-chat-completions` template (the e2e mock
     provider clones one as its seed).
2. **Model lists are discovered at runtime, not hardcoded.** A services-layer discovery client
   (`packages/services/src/model-provider/providerModelDiscovery.ts`, absorbing the P2
   test-key probe) calls the template protocol's model-list endpoint directly over the host
   network transport (proxy settings honored; versioned-path normalization; it NEVER spawns
   the agent runtime):
   - openai-compatible: `GET {baseUrl}/models`, `Authorization: Bearer`.
   - anthropic-compatible: `GET {baseUrl}/v1/models`, `x-api-key` + `anthropic-version`,
     cursor paging via `after_id` while `has_more` **or legacy camelCase `hasMore`**
     (bigmodel/zai anthropic mirrors emit camelCase and ignore cursor params — a
     repeated-first-id guard stops such mirrors from looping; the 10-page cap stays as the
     backstop).
     Both normalize to a model-id list **plus optional per-model capability hints when the
     endpoint provides them**: anthropic-shape `max_input_tokens` (>0) and
     `capabilities.image_input/pdf_input.supported` (real Anthropic API; bigmodel/zai mirrors
     currently return neither — no-op there); openai-compat `context_length` (>0) and
     `architecture.input_modalities` ∩ {image, video} (OpenRouter shape; unknown modalities
     like audio/file ignored; `0`/`null` treated as absent). Hints NEVER override catalog
     rules — at persistence time a hint fills only fields the catalog resolution leaves empty
     (the `.*` catch-all fallback does NOT count as catalog knowledge; endpoint-scoped site
     overlays do). Because the manual schema requires complete rules, applying ANY hint
     persists a complete manual rule: the hint field plus all other manual leaves frozen at
     their creation-time effective values — the model then shadows future catalog changes
     for **all manual leaves** (not just the hint field) until the user edits or removes it;
     accepted trade-off, locked by a regression test. Models saved without hints keep
     following catalog updates (no manual rule). Errors and empty lists degrade gracefully (the
     wizard shows the failure and still allows saving with manually added models). The UI must
     never promise that a listed model is callable by the key — endpoint listings are
     uncontracted external behavior; manual model add remains the fallback.
3. **Wizard: test & discover, and persistence is mandatory.** The key step's "test key" action
   becomes "test & discover": success = key accepted + discovered model list (count shown).
   **(P1.1) Saving auto-discovers when the user never ran it**: the save handler calls the
   discovery service directly (never a stale hook state) whenever discovery state is `idle`
   and the template has an api config — template AND custom paths alike (custom =
   user-entered openai-compat baseUrl + key — the custom form requires a key; keyless local
   endpoints go through the ollama template path). The Continue action is disabled while a
   discovery run is in flight. A previously FAILED discovery is not
   re-run on save (no double 15s waits); failure still saves with zero models and the
   documented escapes. Discovered model ids (+hints) are
   **persisted into the created provider in the same save**. Rationale/invariant: the startup gate requires
   `models.length > 0` and a template-based provider starts with no models of its own — a
   wizard that saves a zero-model provider dead-loops the gate. Locked by the e2e
   wizard-complete⇒usable assertion. A template without an access block (ollama) renders a
   key-less variant of the key step (no key input; unauthenticated discovery).
4. **Schema excision (hard-cut, no migration code).** Deleted in P1: the
   `providerFamilyDomain`/`providerFamilyDomainUpdatedAt`/`providerFamilyDomainMigrated` +
   `providerFamilyConnectionSelections` settings fields (validation, protocol, normalize,
   broadcast) and every consumer read; the `zhipu-account`/`zhipu-coding-plan-api-key` zod
   literals + `ZhipuAccountAccessConfig` + the account overlay layer in `packages/provider`
   - their services wiring; GLM history (`OFFICIAL_GLM_MODEL_IDS` chain,
     `official-glm-selection-v3` migration + its tasksDatabase registration, vendor parts of
     the legacy `config.json` reader); `legacyAccountConnectionSettings` +
     `legacyTeamOrganizationResolver` (amendment A2 originally deferred them to P3, but they
     fed exclusively the deleted `providerFamilyConnectionSelections` field and died fully
     dead in slice 1 — deleted with it). Kept until P3 (master-plan amendment A1): protocol
     account schemas, the five vendor entitlement schema files in `packages/shared`,
     `ProviderFamilyDomain` type + family specs + builtin provider ids, OAuth services.

## Expected-death list (by design — do not "fix")

Per the compile-forced-death ruling (no pre-hiding, no over-deletion), these die in P1 and
stay dead until their owning phase rebuilds them:

- Coding-plan Connect/Upgrade entries and all `providerFamilyDomain`-derived UI (sidebar
  usage summary, composer start-plan quick-select, coding-plan usage panels).
- Off-peak eligibility is inert (`offPeakTaskStore`/`useOffPeakEligibility` lose their
  entitlement source) until P3 re-architects off-peak onto local admission.
- Local account-identity reads in `remoteWorkspaceServiceCollection` (mobile/remote
  observables lose the account branch; providers remain observable).
- CLI account-login surface: the standalone account provider runtime and its compile-forced
  chain died with the account types — top-level `zcode login`/`zcode logout` commands, TUI
  `/login` `/logout` slash commands, and the vendor login picker are gone (the shared
  `zcode-slash-command-help.ts` listing is P4 scope).
- Custom-provider wizard path: discovery now auto-runs on save (P1.1) against the
  user-entered openai-compat baseUrl; when it fails or returns nothing the provider is saved
  with zero models and the gate reopens on next startup with the documented escapes (skip /
  manual model add in settings).

## Migration boundary

Fresh start (alpha policy: no alpha→alpha compat). A stale alpha `personal.json` containing
vendor access types fails whole-file schema parse and loses ALL personal providers — accepted
and locked by a unit test; reinstall/re-init is the documented remedy. CLI session-store
migrations 0020/0021/0022 (GLM selection backfills) are deleted; migration ids 0020-0022 must
never be reused with different SQL (checksum ledger on old databases).

## Acceptance scenarios

1. Unit: catalog loads with 21 templates / 0 account providers / `glm` (case-insensitive)
   present ONLY inside `modelRules` modelMatch patterns + capability properties / 0
   `supportsNativeWebSearch` properties / `templateModelRules` + `builtinProviderModelRules`
   glm-free; provider-data schema rejects a `zhipu-account` config. Resolver: a personal
   provider created with `glm-5.3` resolves contextWindow 1,000,000; `glm-5.3-flash`
   resolves image+video+pdf input; uppercase `GLM-5.3` matches (case-insensitive).
2. Unit: discovery client against mocked openai-compat / anthropic (incl. cursor paging and
   legacy camelCase `hasMore` mirrors that ignore cursors) / error / empty responses;
   metadata hints parsed when present (anthropic `max_input_tokens`/capabilities,
   openai-compat `context_length`/`input_modalities`; 0/null absent; unknown modalities
   ignored); hints fill only catalog-empty fields; discovered ids (+hints) merge into the
   created provider's model list; stale `personal.json` containment behavior.
3. E2E: wizard with mock provider — test & discover succeeds and the completed wizard leaves
   a usable provider (gate closes); discovery failure still allows save; saving WITHOUT ever
   pressing the button still persists models (auto-discover) and the gate stays closed after
   reload.
4. Unit (P1.1): per-provider discovery from the provider's own config (services-side, key
   never surfaced to the renderer or error text); bulk merge dedupes against personal AND
   builtin model ids.
5. Manual: real zai/bigmodel key discovers GLM models via the wizard with correct capability
   metadata (glm-5.3 1M ctx; glm-5.3-flash vision); Ollama template discovers local models
   without a key; settings provider page "discover models" merges new ids; provider metadata
   editor still works.
