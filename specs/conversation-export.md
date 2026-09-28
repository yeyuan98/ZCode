# Spec: Conversation Export (libre-zcode P5, decision D3)

Status: design of record for P5. Owner: `packages/services/src/conversation-export/` (new) +
`packages/ui` header action + `IPlatformService.saveFile`.

Replaces vendor-hosted conversation share entirely (publish → `{ZCODE}/cn/share`, web landing,
`zcode://share/import`, the last `zcodejwttoken` readers).

## Behavior

1. **Export v1 = whole-session Markdown** (D-P5.7). A single header action exports the active
   conversation to a user-chosen `.md` file (`zcode-session-<slug>.md`). Turn selection and
   artifact bundling are deferred to a possible v2.
2. Content: user/assistant messages, reasoning sections, tool calls with fenced inputs/outputs,
   artifact references by display name + MIME + path (no file copying), and an explicit notice
   line for row kinds that cannot be rendered. The formatter extends the former
   `formatSharedContextV1`: `subagent`/`hookInvocation` rows are rendered (or skipped with
   notice) instead of throwing; local/relative artifact sections replace the deleted
   `zcode-artifact://share/` scheme; the "unknown row kind must not silently vanish" discipline
   and `markdownSha256` are kept.
3. **In-flight guard**: export refuses while the session has a running turn / streaming row /
   active tool call / active subagent (subset of the former share structure-issues check) —
   export is point-in-time.
4. **Delivery**: service returns `{ markdown }` over the service channel; renderer calls
   `platform.saveFile` (native save dialog on desktop, ≤50 MB payload — plain markdown is far
   below). Web platform gains a Blob-download fallback. Logging via
   `createServiceLogger("conversation-export")`.
5. **Deletions** (compile-clean in one commit; symbol-sweep not line-ranges): vendor publish +
   import + capability/continuation machinery, `conversationShareHttpClient`, web landing
   (`packages/web/src/share/**`), `zcode://share/import` chain (deep link, preload, platform,
   channels, renderer import flow), public projection / integrity / artifact-discovery modules,
   UI publish surface (menu, docks, selection store, preflight cache, helpers), 165 i18n keys
   per locale, `packages/shared/src/conversation-share.ts` (whole file, including
   `decodeConversationShareRows` — no post-P5 consumer), `conversationShareAttachmentService`,
   connection-scope facade, client proxy + barrel exports, VITE share defines.
   `conversationShareArtifactSource.ts` is deleted (zero consumers in v1; re-added with
   bundling if v2 lands).
6. **Kept decode-only (protocol-durable state)**: `zcodeSessionImportHistorySchema`
   `sharedContext` variant + v4 `shared-context-import` snapshot schema + CLI attach state
   machine — old sessions' snapshots parse against them; `persistImportedSessionHistory`
   survives (live claudeCode-variant producers; only the sharedContext sender dies).
7. **Legacy imported sessions (D-P5.2, hard-cut)**: read-only timeline rendering
   (`ConversationShareReadonlyTimeline`), `getImportedConversation` UI block, and the
   composer's shared-context attach are deleted. Underlying session data still loads.
   `parseConversationShareContext` (legacy markup stripper for historical rows) is KEPT so old
   messages don't render raw share markup; its sibling `resolveAttachableShareContext` dies
   with the attach path.

## Ownership & invariants

- Single owner: `IConversationExportService` (new `conversation-export` service channel);
  reads via generic V4 agent methods (`conversationRowsRangeV4`) — no share-specific protocol
  survives.
- No network: export is fully local.
- UI accesses the service via `packages/ui/src/hooks` accessor pattern; platform file-write via
  `IPlatformService` only.

## Tests

Formatter row-kind matrix (incl. subagent/hookInvocation/artifacts/unknown-kind notice),
in-flight guard, service happy path, e2e export smoke (download triggered on web).

## Migration boundary

Hard-cut: previously imported share sessions lose their preview block and attach behavior
(data parses; display removed). No share links can be created or re-imported. No migration
code (alpha policy).

## Amendments (in-phase, W4b)

1. Input shape = `{workspacePath, workspaceIdentity?, remoteSessionId?, sessionId}` (rowsRange/readSession are workspace-scoped; mirrors the old preflight input). Result adds `fileName` alongside `markdown` (renderer needs `suggestedName`).
2. `formatSharedContextV1` replaced in-place by `formatConversationExportV1` (zero consumers post-W4a; discipline preserved).
3. Error model: `conversation_running` kind + cross-RPC error-kind reader added to `conversationExportError.ts`.
4. Connection-scope factory re-implemented in slim form (Symbol + `scopeConversationExportServiceForConnection` + overrides at the 4 host exposure sites) — `conversationRowsRangeV4` trusted-carrier check requires it (the reason the old share service had one).
5. Export is not gated on desktop-attached remote hosts (old share needed vendor auth there; export is local-only, all host modes share one construction).
6. e2e export smoke descoped to manual QA (harness mock provider cannot produce a completed agent turn without heavy scaffolding); services-level tests cover formatter/guard/happy-path.
7. `conversationRowSelection.ts` (selectRows) dropped entirely at [ulw] review (knip-unfriendly dead seed; git history preserves it for a possible v2).
