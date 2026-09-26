# Spec: Provider Catalog & Model Discovery (libre-zcode P1)

Status: implemented-by P1 (`v3.14.3-alpha.4`). Owners: provider catalog
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
   - Zero GLM-id-keyed rules **and zero case-insensitive `glm` matches in the catalog JSON**
     (the P6 vendor-free gate greps `glm` case-insensitively; its allowlist covers only
     provider display names, baseUrls, logo keys and key-management URLs). Vendor templates
     carry NO `builtinModelIds`; GLM ids are also stripped from generic aggregator templates
     (openrouter/opencode-go/opencode-zen) — those models come back via discovery or manual
     add. The single `.*` default modelRule stays.
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
     cursor paging via `after_id` while `has_more`.
   Both normalize to a plain model-id list. Errors and empty lists degrade gracefully (the
   wizard shows the failure and still allows saving with manually added models). The UI must
   never promise that a listed model is callable by the key — endpoint listings are
   uncontracted external behavior; manual model add remains the fallback.
3. **Wizard: test & discover, and persistence is mandatory.** The key step's "test key" action
   becomes "test & discover": success = key accepted + discovered model list (count shown).
   Discovered model ids are **persisted into the created provider in the same save** (initial
   model ids on personal-provider creation). Rationale/invariant: the startup gate requires
   `models.length > 0` and a template-based provider starts with no models of its own — a
   wizard that saves a zero-model provider dead-loops the gate. Locked by the e2e
   wizard-complete⇒usable assertion. A template without an access block (ollama) skips the
   key step entirely.
4. **Schema excision (hard-cut, no migration code).** Deleted in P1: the
   `providerFamilyDomain`/`providerFamilyDomainUpdatedAt`/`providerFamilyDomainMigrated` +
   `providerFamilyConnectionSelections` settings fields (validation, protocol, normalize,
   broadcast) and every consumer read; the `zhipu-account`/`zhipu-coding-plan-api-key` zod
   literals + `ZhipuAccountAccessConfig` + the account overlay layer in `packages/provider`
   + their services wiring; GLM history (`OFFICIAL_GLM_MODEL_IDS` chain,
   `official-glm-selection-v3` migration + its tasksDatabase registration, vendor parts of
   the legacy `config.json` reader). Kept until P3 (see master-plan amendments A1/A2):
   protocol account schemas, the five vendor entitlement schema files in `packages/shared`,
   `ProviderFamilyDomain` type + family specs + builtin provider ids, OAuth services,
   `legacyAccountConnectionSettings`.

## Expected-death list (by design — do not "fix")

Per the compile-forced-death ruling (no pre-hiding, no over-deletion), these die in P1 and
stay dead until their owning phase rebuilds them:

- Coding-plan Connect/Upgrade entries and all `providerFamilyDomain`-derived UI (sidebar
  usage summary, composer start-plan quick-select, coding-plan usage panels).
- Off-peak eligibility is inert (`offPeakTaskStore`/`useOffPeakEligibility` lose their
  entitlement source) until P3 re-architects off-peak onto local admission.
- Local account-identity reads in `remoteWorkspaceServiceCollection` (mobile/remote
  observables lose the account branch; providers remain observable).

## Migration boundary

Fresh start (alpha policy: no alpha→alpha compat). A stale alpha `personal.json` containing
vendor access types fails whole-file schema parse and loses ALL personal providers — accepted
and locked by a unit test; reinstall/re-init is the documented remedy. CLI session-store
migrations 0020/0021/0022 (GLM selection backfills) are deleted; migration ids 0020-0022 must
never be reused with different SQL (checksum ledger on old databases).

## Acceptance scenarios

1. Unit: catalog loads with 21 templates / 0 account providers / 0 `glm` matches
   (case-insensitive) / 0 `supportsNativeWebSearch` properties; provider-data schema rejects
   a `zhipu-account` config.
2. Unit: discovery client against mocked openai-compat / anthropic (incl. cursor paging) /
   error / empty responses; discovered ids merge into the created provider's model list;
   stale `personal.json` containment behavior.
3. E2E: wizard with mock provider — test & discover succeeds and the completed wizard leaves
   a usable provider (gate closes); discovery failure still allows save.
4. Manual: real zai/bigmodel key discovers GLM models via the wizard; Ollama template
   discovers local models without a key; provider metadata editor still works.
