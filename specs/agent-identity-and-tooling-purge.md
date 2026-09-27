# Spec: Agent Identity Rename + WebSearch/Gateway Purge (libre-zcode P4)

Status: design-of-record for P4 (alpha.8). Owners: shared provider/protocol types
(`packages/shared/src/*`); CLI runtime packages (`apps/zcode-cli/packages/*`); provider config
(`packages/provider`, `packages/provider-node`); services adapter/skills/bots
(`packages/services/src/*`); desktop main packaging/env (`packages/desktop/src/main/*`,
`electron-builder.config.js`, `scripts/`, `desktop/scripts/`); UI identity/theme surfaces
(`packages/ui/src/*`); web theme seed (`packages/web/*`).

## Behavior

P4 removes the remaining vendor identity and machinery from the running product in four
domain-ordered packages (each lands compiling green; shared/CLI/UI/desktop edits for one
domain travel in one commit):

1. **WebSearch + capability plumbing excision (B).** Delete the WebSearch tool end-to-end:
   handler files (`websearch.ts`, `websearch-results.ts`, `websearch-support.ts`), contract
   file + barrel/package-export entries, the anthropic-only encoding branch in
   `tool-transform.ts` (import, option, dispatch, branch, helpers), the exposure gate, the
   required per-model field `supportsNativeWebSearch` across the data model
   (`shared/model-config.ts`, `provider/config/model-config.ts`, `manual-model-config.ts`,
   `config-service.ts`, `resolver.ts`, `prompt-trajectory/record.ts`), every name-keyed list
   entry (tool-identity known names/families — the `"search"` family itself stays —
   explore-tools, microcompact, permission read-only set, explore profile,
   provider-visible-order, tool-visibility alias + allowlist call, scheduler read-only set,
   subagents defaults, UI `SubagentsSection` tool options, CLI `arguments.ts` alias rewrite),
   both identity-mapped telemetry enum members together, the `providerNative` tool mechanism
   (sole user was WebSearch: contract/tool-contract fields, model contract passthrough, core
   tool types/registry), UI metadata-editor field (`ProviderModelMetadata.ts`,
   `ProviderModelDraftState.ts`, `ProviderModelMetadataDialog.tsx`), i18n
   (`settings.modelProvider.supportsNativeWebSearch` key + the capabilities help bullet, both
   locales), `NOTICE.md` WebSearch row. **Keep:** `webSearchRequests` usage-accounting fields
   (provider-reported billing counters present in persisted session history — contracts,
   protocol, runner normalization/diagnostics, TUI), the `"search"` tool family
   (Glob/Grep/WebFetch), embedded-search paths, the catalog glm-free invariant test.
2. **Gateway + start-plan error cluster + dead vendor residue (C).** Delete the official
   coding-plan gateway rewrite (`official-coding-plan-gateway.ts` + `model-execution.ts`
   wiring + barrel export) so zai/bigmodel templates connect directly to their stated base
   URLs; delete the 3008/3009/3010 start-plan cluster everywhere (streaming-recovery sets and
   helpers, `turn-model-step.ts` admission-retry branch + `start_plan_admission_retry_discarded`
   finish, `target-completion-verification.ts` retry loop, `failure-provider-business-codes.ts`
   entries — generic 429 classification absorbs, UI `providerBusinessError.ts` entries + i18n
   keys 3008/3009/3010 + dead 3102 key + dead `ZCODE_BIGMODEL_TEAM_PLAN_MEMBER_REQUIRED` code
   and keys); delete the dead `ModelRetryReason.OffpeakQueued` value + consumers (incl. UI
   `workflowRunThrottle.ts` entry + `throttle.reason.offpeak` keys); delete the inert
   `ModelRequestAuth` chain (~20 files: contracts invocation-context + `ModelRequestAuthMissing`
   code, core attach sites + port logic + `child-client-ports.ts` reroute, adapters
   runner-runtime chain incl. `runner-runtime-headers.ts`, bootstrap port + workspace wiring,
   protocol methods/schemas in `shared/zcode-protocol/index.ts`) and rework the session-title
   deferral gate that waited on the dead port; delete phase-3 flagged residue (`tui/app-submit.ts`
   login redaction regex, `command-center/history.ts` api-key pattern, `slash-command-types.ts`
   login/logout union members, `provider-runtime-env.ts` login/logout argv routing,
   `shared-credentials.ts` vendor keys/types/methods — generic credential store stays for MCP
   OAuth, raw `zcodejwttoken` reads stay until P5 share deletion — and the unreachable
   `"account-plan"` branch in `effective-model-selection.ts` + union member + mapping);
   neutral-rename `provider-finish-business-error.ts` bracketed-code symbols/comments (parsing
   stays); drop 3008/3102/3105-citing comments; `NOTICE.md` gateway row removal. **Keep:**
   the other documented BigModel error codes (1120…1321/2056/20097 etc.) — endpoint-behavior
   semantics of an equal vendor; `resolveRuntimeZCodeEndpointOrigin` (live users remain).
3. **`glm` → `zcode` rename (D).** Both provider literals flip in one commit
   (`shared/providers.ts` `ZCODE_PROVIDERS` + `shared/zcode-task-types-core.ts` inline
   `ZCodeProvider`); `ZCODE_AGENT_PROVIDER = "zcode"`; task-event value/type names
   (`glm_agent_model_state_update` → `zcode_agent_model_state_update`, `ZCodeGlmAgent*` →
   neutral; desktop-internal, CLI never sees the literal); outbound identity headers
   (`X-ZCode-Agent: zcode`; `HTTP-Referer` from the vendor platform origin to the repository
   URL); env `GLM_BINARY_PATH` → `ZCODE_AGENT_BINARY_PATH` and bundled/remote resource dir
   `glm/` → `zcode/` in lockstep across descriptor, desktop env writer/reader (incl. the
   `desktopRuntimeEnv.ts` injection line), resolver, deploy paths, remote package id,
   install-lock list, electron-builder resource mapping + signIgnore, and the staging scripts
   (`prepare-prebuilds.mjs`, `desktop/scripts/stage-agent-bundle.mjs`,
   `prepare-agent-node-bundle.mjs`, `koffi-package-assets.mjs`); skill-id prefix `glm:` →
   `zcode:` producer + all consumers atomically (enablement maps are path-keyed — unaffected);
   icon component/assets rename (+ delete orphan `icon-glm.png`; regenerate
   `third-party/inventory.json` coverage); literal sites in services/desktop (task adapter
   alias renamed to neutral, skills, host, bots schema/labels, task-model recovery); comment
   rot cleanup where touched. **Keep:** GLM model-id capability rules in the catalog (A5),
   zai/bigmodel provider display names/baseUrls/logos/key-management links, the pre-existing
   both-strings legacy decode in `provider-selection-v2.ts`.
4. **Theme rename + fetch identity + comment neutralization (E).** `zai-dark`/`zai-light` →
   `zcode-dark`/`zcode-light` (ids, CSS classes, persistence default, i18n keys, web seed +
   share route, desktop renderer/resource-manager; no old-value fallback); WebFetch
   User-Agent URL → repository URL; neutralize GLM/Z.ai/bigmodel-citing comments on kept
   behavior (compact empty-length guard, tool_result image ordering, workflow submit_result
   coercion, browser-locator stable-pointer note). Already-neutral surfaces untouched.

## Rulings recorded (2026-09-28)

- **Ruling 1 (hard cut, no migration):** persisted values containing `"glm"` (task metadata,
  bot records, UI supplier keys), `zai-*` theme ids in local storage, and `GLM_BINARY_PATH`
  user overrides are NOT migrated or dual-read. Alpha policy: development-first, breakage
  expected, no alpha→alpha compat code. Recorded breakage: old tasks lose provider labels;
  affected bots must be re-created; model selections re-picked; theme resets once; env
  override renamed; remote agent runtime re-downloads; stale `glm/` install dir is inert.
- **Ruling 2 (hard cut for stored configs — supersedes an earlier normalization proposal):**
  personal model-config files carrying `properties.supportsNativeWebSearch` are NOT cleaned
  up; after the field is deleted, strict parse of such files fails per the existing
  corrupt-config path. No normalization/migration code is added.
- **Rulings 3–5 (delete):** `ModelRequestAuth` chain dies in P4 (both ends inert; wire method
  unused since ≥alpha.2); `providerNative` mechanism dies with WebSearch; `OffpeakQueued`
  value + consumers die (replay parsers are open-string; old replays may render raw codes).
- **Rulings 6–8 (identity/keep):** `X-ZCode-Agent: zcode` + Referer → repository URL; both
  theme ids rename; all other documented BigModel error codes stay (numeric-code-keyed but
  carrying ordinary-API semantics, unlike the start-plan-only 3008–3010 cluster — recorded so
  the final vendor-string gate does not relitigate).

## Invariants

- The provider literal exists in exactly two source sites and flips in one commit with its
  importer fan-out; no third literal may be introduced.
- The binary/dir/env rename is single-descriptor-driven: `zcode-agent-runtime.ts` is the one
  source; `desktopRuntimeEnv.ts` (def/read/**write**), `providerRuntimeResolver.ts`, deploy
  paths, packaging config, and staging scripts must agree in the same commit — a missed env
  writer breaks packaged agent spawn, not just user overrides.
- Skill-id prefix is a cross-boundary contract (CLI mints, UI filters): producer and consumers
  flip atomically.
- Deletion completion is grep-verified per package (word-boundary, case-insensitive), not
  prose-list-verified; expected-death lists are regenerated at implementation time.
- webSearchRequests accounting fields, the `"search"` tool family, catalog GLM capability
  rules, and BigModel ordinary error codes are protected keep-lists.

## Failure semantics

- Old config files with the removed field fail strict parse and follow the existing
  corrupt-config handling (re-initialization); no data rescue.
- Old replayed sessions may render raw `offpeak_queued` codes; parsers never crash on them.
- Numeric 3008/3009/3010 from any provider classify through the generic rate-limit path; no
  vendor-plan semantics remain anywhere.
- zai/bigmodel template traffic connects directly to configured base URLs; no silent rewrite.

## Test matrix

Units: tool registry/getTools excludes WebSearch and rejects its schemas; provider enum/
event/policy carry `zcode` values; binary resolution honors `ZCODE_AGENT_BINARY_PATH` +
bundled `zcode/` dir (resolution extracted into a services-testable module); skill catalog
mints `zcode:` ids and the UI filter matches; fake numeric-3008 error classifies via the
generic rate-limit path; zai/bigmodel anthropic base URLs pass through fetch selection
untouched; session titles generate on schedule after the dead deferral gate is removed;
persisted `offpeak_queued` event replays without error. Existing suites stay green (three
tests asserting `"glm"` update); catalog invariant test unchanged. Gates: root
typecheck/lint/fmt/architecture/knip (set comparison) + `verify:pre-push`; CLI
typecheck/lint/format/registry; all node-test suites + e2e (builds web first);
`pnpm smoke:windows-bundle` mandatory (installer resource layout changes). Manual: fresh
Windows alpha.8 — agent spawn, permission prompts, WebSearch absent, MCP search replacement,
theme persistence, off-peak regression pass.
