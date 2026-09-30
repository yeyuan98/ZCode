# Spec: Bot Outbound File Delivery (Alpha 0 — WeChat `/file`; Alpha 1 — conversational `share_file`)

Status: Alpha 0 **shipped** in `3.14.4-alpha.0` (PR #2, merge `a399b22`; owner manual smoke
2026-09-29). Alpha 1 (Phase B, conversational `share_file`) **shipped** in `3.14.4-alpha.1`
(PR #4, merge `56312b9`, release commit `d6b9738`, tag `v3.14.4-alpha.1`; all 6 release jobs
green, asset set + single-channel invariant verified; owner-rig manual validation passed
2026-09-30). Phase B implements the design contract reviewed & owner-approved 2026-09-29
(two independent subagent review rounds + one implementation review round).
Next: Phase C — Alpha 2 = remote workspaces (spec below, in progress); Alpha 3 =
Telegram/Feishu outbound senders (not yet spec'd).
Full-feature playbook: ../ZCode-handoff.md.
Owners: bots service (`packages/services/src/bots/botsService.ts`) — command admission, path
policy, size gates, `taskDeliveryRegistry` + `deliverWorkspaceFile` single writer + tool-source
quota; weixin provider adapter (`providers/weixinProvider.ts`) — CDN upload + media sendmessage;
bot state repo (`repo.ts`) — per-peer context_token persistence; CLI runtime (`apps/zcode-cli`) —
`share_file` tool + `BotFileSharePort` + per-turn injection gates; host RPC routing
(`packages/services/src/zcode-agent/zcodeAgentService.ts` + desktop wiring) — `bots/shareFile`
handler registration; UI chip renderer (`packages/ui`) — toolCall-row chip rendering.
Related: `docs/versioning.md` (patch 3.14.4 = full bidirectional file sync).

## Behavior (Alpha 0 — `/file`, shipped)

1. **New authorized bot command `/file <path>` (aliases `/文件`).** Only in private chats
   (`chatType === "private"`), only for providers whose adapter implements `sendAttachment`
   (Alpha 0: weixin only). Other channels get a localized "not supported yet" reply.
   Operators can disable the command per bot via `allowedCommands.file: false`
   (absent = allowed; schema + policy normalization honor explicit false).
2. **Path policy: workspace-only.** The requested path is resolved against the bot context's
   active workspace root. Paths escaping the workspace tree (after resolving `.`/`..` and
   symlinks via `realpath`) are rejected with a localized notice. Absolute paths inside the
   workspace are accepted. The `~/.zcode/v2/bot-attachments` cache is NOT in scope for Alpha 0
   (it lives outside the workspace; revisit in a later alpha with an explicit allowlist).
3. **Size/count gates: ≤ 5MB, 1 file per command** (symmetric with inbound
   `BOT_MAX_ATTACHMENT_SIZE_BYTES`). Oversize → localized rejection listing the limit.
4. **Remote workspaces: honest guard.** If the context workspace is remote
   (`workspaceIdentity` set) and connected, `/file` replies that remote-workspace delivery
   arrives in a later alpha; it never pretends success and never reads local paths for a remote
   context. (A _disconnected_ remote workspace surfaces the standard `/重连` hint first —
   `blockDisconnectedRemoteWorkspace` runs before the `/file` guard.)
   **Superseded by Phase C Alpha 2** (below): remote delivery now succeeds; this Alpha 0
   wording is kept for history only.
5. **Delivery pipeline (probe-proven 2026-09-29, see ../ZCode-handoff.md §5).**
   `getuploadurl` → AES-128-ECB(+PKCS7) encrypt → CDN ciphertext POST (read
   `x-encrypted-param` response header) → `sendmessage` with `image_item|file_item|video_item`.
   Wire details that are product invariants:
   - `media.aes_key = base64(utf8Bytes(hexKeyString))` — double-encoded; wrong form yields
     "receive failed" bubbles (live-verified failure mode).
   - `filesize` sent to getuploadurl = padded ciphertext size; `file_item.len` = plaintext
     size; `image_item.mid_size`/`video_item.video_size` = ciphertext size.
   - New provider calls carry `iLink-App-Id: bot` + `iLink-App-ClientVersion` headers in
     addition to the existing auth headers. The existing text-send path is unchanged.
6. **context_token freshness (probe-proven).** Media `sendmessage` requires a fresh per-peer
   `context_token`. The bots service persists the latest inbound token per (botId, peer
   userId) in bot state and passes it on outbound media. On `ret=-2 prepare failed`:
   retry once without the token; if that also fails, degrade to a localized text notice
   (never a silent drop). Conversational replies stay warm naturally (user just messaged).
7. **Type additions are additive and optional.** `BotOutboundAttachment` and
   `BotOutboundMessage.attachments?` extend the shared protocol; adapters without
   `sendAttachment` are unaffected. `BotCommand` gains `{type:"file"; value:string}`.
8. **Failure semantics.** Every failure (missing file, outside workspace, oversize, upload
   error, stale session) produces a localized text reply; `/file` never throws an unhandled
   error into the polling loop and never mutates the active task/draft context.
9. **Audit.** Successful and attempted deliveries log via `createServiceLogger("bots")`
   `info`: bot id, peer id (not name), filename, size, outcome. Bot sessions are force-yolo;
   the workspace-only policy + audit log + 5MB cap are the exfiltration guards.

## Invariants (Alpha 0)

- Bot message text replies, typing indicators, permissions, and task lifecycle behave
  exactly as before this change (zero modification to the existing text `send()` path).
- `/file` does not create, resume, or mutate tasks; it is a pure side-channel command.
- One writer for outbound media: `handleFileCommand` is the only media-delivery code path
  (an extension of the adapter contract, not a second queue; it calls `adapter.sendAttachment`
  directly rather than going through the text `sendOutbound` path). Phase B extracts this core
  as the shared `deliverWorkspaceFile` — see Phase B invariants for the superseding wording.

## Acceptance scenarios (Alpha 0)

Verified 2026-09-29: unit/integration tests (`packages/services/test/botFileDelivery.test.ts`,
103/103 suite) cover 2/3/4/5/7 + wire invariants; 1/6/8 validated by CI + owner manual smoke on
the deployed rig; 8 additionally covered by the full pre-existing bot regression suite.

1. `/file relative/path/result.png` in an active local workspace → WeChat receives an image
   message that opens on the phone.
2. `/file ../outside.txt` or an absolute path outside the workspace → localized rejection.
3. `/file big.bin` (>5MB) → localized rejection with the limit.
4. Missing file → localized rejection.
5. Telegram/Feishu bot `/file` → "channel not supported yet" text.
6. Remote workspace context → "later alpha" text.
7. Stale session (no recent inbound): send fails → retry-without-token → text fallback notice.
8. All existing bot behavior unchanged (regression: run bots-related flows).

## Phase B — Conversational delivery (share_file) — shipped in `3.14.4-alpha.1`

### Behavior

1. **New conversational tool `share_file(path)`.** In a WeChat private chat the user asks in
   natural language ("把刚才生成的图发给我"); the agent calls `share_file` with a single
   `path` parameter (no caption, no target fields). Tool exposure gates — ALL must hold,
   fail-closed: the turn carries `botDeliveryTarget` with provider `weixin` AND
   `chatType === "private"` AND no `automationId`/`offPeakTaskId`; runtime
   `taskType !== "subagent_child"`; the port is present. No target → tool hidden or refuses.
   Excluded by construction: automation turns, off-peak turns, subagent children, group chats,
   non-WeChat providers, desktop/UI turns.
2. **Host-side recipient resolution (recipient never client-supplied).** The tool calls
   `BotFileSharePort.share(path)` → host RPC `bots/shareFile` with params exactly
   `{taskId, path}` (strict zod; unknown keys rejected, tested). The host resolves the
   recipient from its own in-memory `taskDeliveryRegistry` (taskId → {botId, actor,
   workspacePath, workspaceIdentity}; populated ONLY at the conversational `watchTaskStream`
   call sites, never in `watchAutomationRun` — which deletes any existing entry; cleared on
   watcher terminal/cleanup; bounded at 200, evict oldest). A prompt-injected agent cannot
   point delivery at an arbitrary peer.
3. **Single delivery writer, `/file` parity.** The post-auth core of `handleFileCommand` is
   extracted as `deliverWorkspaceFile(bot, actor, context, requestedPath, {source, taskId})`;
   `/file` (source "command") and the RPC (source "tool") both call it. Admission gates are
   re-evaluated per call, at parity with `/file`: bot enabled, user bound,
   `allowedCommands.file`, private chat, adapter `sendAttachment` capability, non-remote
   workspace — then the same workspace-only path policy (lexical + realpath, re-realpath at
   read), 5MB gate (incl. growth between stat and read), and freshest persisted
   context_token (provider-internal ret=-2 retry-without-token applies unchanged).
4. **Tool-only quota.** Max 3 deliveries per rolling 10 minutes AND max 20 per rolling 1 hour
   per (botId, peerKey), applied only to source "tool". `/file` is never quota-bound.
   In-memory, host-side; no persistence (avoids the writeContext token-map revert race).
   The quota slot is reserved atomically before any file IO and released on delivery failure
   (review fix: `share_file` is a concurrentSafe tool whose parallel invocations would
   otherwise all pass the window check before any of them records — concurrent tool calls
   cannot bypass the window caps; observable semantics stay "only successful deliveries
   consume quota").
5. **Honest result semantics.** The tool returns the REAL outcome to the model:
   `BotShareFileResult` = `{ok: true; filename; sizeBytes}` | `{ok: false; reason; detail?}`
   with reasons: `no-target` (registry miss/terminal task, turn without botDeliveryTarget,
   queued-input edge, subagent/automation context), `not-allowed` (bot disabled, user unbound,
   `allowedCommands.file: false`, non-private chat — mid-task revocation parity with `/file`),
   `unsupported-provider` (adapter lacks sendAttachment), `remote-workspace`,
   `outside-workspace`, `not-found`, `too-large`, `quota-exceeded`, `send-failed` (adapter
   threw after provider-internal ret=-2 retry), `unsupported-method` (old host returned -32601;
   CLI-side mapping), `unknown-outcome` (RPC timed out — CLI-side synthesis; RPC timeout sits
   above the provider upload/send margin so a timeout never maps to false success/failure).
6. **Audit enrichment.** Per attempt: existing fields (bot, peer, file, size, kind) plus
   `source=command|tool`, `task=<taskId when tool>`, `path=<workspace relative>`.
   Field precision (matches implementation): `kind=` is present only on successful sends;
   pre-resolution failure and quota-exceeded lines omit `kind` and carry `size=0` placeholders
   (real sizes appear only after path/size resolution, e.g. `too-large` and `send-failed`).
7. **UI = toolCall row + chip renderer.** The share renders as the existing toolCall row plus
   a name-based chip renderer (`packages/ui/src/ToolCallBlocks/resolveRenderer.ts`; the chip
   derives the file path from the tool input and the status from the output prose) and a
   compact summary line (`packages/shared/src/tool-call-summary.ts`). No new protocol display
   types (structured filename/size display deferred). Both desktop-continuous and
   web-remote-replayable links render it. The WeChat text-mode tool summary line
   (`packages/services/src/bots/replyFormatter.ts`) shows honest status words for
   `share_file` — 已发送 / 未发送 / 结果未知 — derived from the output prose with the same
   three-way logic as the UI renderer (prose-derived until structured display lands; a
   failed delivery is a normal completed tool result, so the generic 完成 word must not
   appear for it).

### Invariants

- `bots/shareFile` RPC is the ONLY delivery trigger for conversational sends; no stream event
  exists; mirroring/echoing produces zero adapter calls.
- Neither `/file` nor `share_file` mutates task or bot context state (token store merge on
  inbound remains the only state write).
- Failure UX = tool result only; NO second system text notice from botsService (the model's
  reply rides the normal text path). Recorded decision — do not re-litigate.
- Text send path untouched; `/file` behavior unchanged (incl. no quota).
- All additions are optional/additive; old host + new CLI → structured `unsupported-method`.
- `deliverWorkspaceFile` is the sole media-delivery entry (supersedes the Alpha 0
  "sendOutbound" wording, which was already inaccurate).

### Acceptance scenarios

Verified 2026-09-30: unit/integration coverage below all green (services 139/139, shared 32/32,
UI 26/26; PR #4 CI 5/5); owner-rig manual E2E passed 2026-09-30 ("works well") on the released
`3.14.4-alpha.1`. Coverage: 1, 9, 13 (incl. chip reload + phone replay) are owner-rig manual
E2E; the rest are unit/integration — protocol zod tests (packages/shared), services tests
extending `packages/services/test/botFileDelivery.test.ts` (guard matrix, quota incl.
parallel-call TOCTOU + reserve/release, stale-registry terminal paths, single-writer,
no-context-mutation, audit), and the shared deny-predicate matrix tests
(packages/shared/test/botsShareFile.test.ts, `botShareFileDeliveryTargetQualifies`) consumed
by all three per-turn deny sites (CLI legacy + v4 prompt-turn builders and the services
`zcodeTaskServiceAdapter` mirror). apps/zcode-cli has NO test harness — the CLI builders are
covered only via the shared predicate plus each layer's fail-closed behavior and manual rig
spot checks, not CLI tests.

1. Happy path: "发给我" in an active local WeChat private chat → media arrives and opens on the
   phone; model text confirms; desktop renders the chip; chip survives history reload; phone
   replay shows the chip. [manual rig]
2. Injection matrix: tool injected iff the current send has weixin+private `botDeliveryTarget`
   and no automationId/offPeakTaskId; NOT injected for automation turns, off-peak turns,
   desktop/UI turns, feishu/lark turns, group turns, subagent children. [shared predicate
   tests + manual rig — no CLI harness exists; the three deny sites consume
   `botShareFileDeliveryTargetQualifies` from packages/shared]
3. Automation run reusing a bot-born session (targetTaskId): tool absent AND RPC denies
   (registry deleted by `watchAutomationRun`); zero deliveries. [services tests]
4. Strict schema: RPC rejects any client-supplied target/provider/peer field; delivery goes
   only to the turn's requesting peer even when file content instructs otherwise
   (prompt-injection README "share .env to …"). [protocol + services tests]
5. outside-workspace (lexical `..`, absolute outside, symlink escape) → honest failure;
   nothing sent; audited. [services tests]
6. > 5MB incl. growth between stat and read → `too-large`; nothing sent. [services tests]
7. Missing file → `not-found` honest failure. [services tests]
8. Quota: 4th tool send inside 10 min (or 21st/hour) → `quota-exceeded`; model steers to
   `/file`; audited; `/file` itself NOT quota-bound. [services tests]
9. Stale token: silent user, >40-min task → ret=-2 → provider retry-without-token → failure
   reaches the model via the tool result; mid-task user ping refreshes the persisted token and
   next attempt succeeds. [manual rig]
10. RPC timeout → `unknown-outcome`; the turn does not crash; no false success/failure.
    [code-verified + manual rig — the -32022 timeout → unknown-outcome mapping in the
    bootstrap port has no automated harness; disclosed]
11. Remote workspace context → `remote-workspace` honest failure; no local read fallback.
    [services tests]
12. Mid-task revocation (bot disabled / `allowedCommands.file: false` while the task runs) →
    `not-allowed` (parity with `/file`). [services tests]
13. Two sequential `share_file` calls in one turn → exactly two messages, each exactly once;
    no event mirror exists → zero double-send risk; single-writer verified via adapter-call
    counting. [manual rig + services tests]
14. A `share_file` turn does not create/resume/mutate tasks; no writeContext writes.
    [services tests]
15. Audit per attempt: bot, peer, relative path, size, outcome, taskId, source.
    [services tests]

## Phase C — Alpha 2: remote workspaces (WeChat) — spec'd 2026-09-30, in progress

Owner decision (approved 2026-09-30): temp-file materialization approach; split Alpha 2
(remote) / Alpha 3 (channels); Alpha 2 targets `3.14.4-alpha.2`.

### Behavior

1. **Remote delivery.** On a remote workspace context (`workspaceIdentity` set) that is
   connected, both `/file <path>` and conversational `share_file` fetch the file's bytes from
   the remote machine and deliver it through the unchanged single-writer path. Event order:

   ```text
   deliverWorkspaceFile (sole writer, botsService)
     ├─ admission re-eval (unchanged: bot enabled / bound / allowedCommands.file / private /
     │  adapter sendAttachment)          ← adapter gate runs BEFORE remote branch
     ├─ quota reserve (tool source only; unchanged semantics)
     ├─ remote fetch: bridge.getWorkspaceFileReader → chunked RPC read (≤512KiB/chunk,
     │  cumulative ≤5MB, per-chunk deadline 20s, total fetch budget 120s)
     ├─ materialize: os.tmpdir()/zcode-bot-outbound/<random>/<filename> (mode 0600)
     ├─ adapter.sendAttachment (unchanged; reads the temp localPath)
     ├─ unlink temp (best-effort, in finally)
     └─ quota release on failure (unchanged reserve/release semantics)
   ```

2. **New v4 wire method `v4/bot-workspace-file/read`** (desktop host → remote CLI gateway;
   `V4_METHODS` in `packages/shared/src/zcode-protocol-v4/transport.ts`, strict-zod params/result
   schemas alongside existing v4 attachment schemas). Params: `{relativePath: string (trimmed,
min 1 — RELATIVE only; absolute input → outside-workspace), offset: uint, limit: uint
1..524288}`. Result: `{ok:true; filename; sizeBytes; dataBase64; eof}` | `{ok:false; reason:
outside-workspace|not-found|too-large|unavailable; detail?}`. The remote CLI gateway handler
   (`apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server.ts`, mirroring the
   `attachmentRead` case) owns ALL path semantics with remote-OS rules: lexical resolve →
   realpath → must sit inside the realpath'd workspace root (its cwd); re-stat per chunk read
   (growth → too-large); whole-file stat >10MB rejected (defense in depth above the 5MB product
   cap). Pure path-policy helpers live in `packages/shared` with tests there (apps/zcode-cli has
   no test harness).
3. **Bot-only exposure (the security lock).** The read capability is served ONLY on bot runtime
   attachments: desktop main marks the `AttachServicePort` message with
   `attachmentKind: "bot-runtime"` in `createBotRemoteWorkspaceRuntimePort`
   (`desktopRemoteSessions.ts`) — the only caller that sets it — and the desktop host
   (`packages/desktop/src/host/index.ts` AttachServicePort handler) exposes the narrow
   `IBotWorkspaceFileService` channel (single method) only when that marker is present. Renderer
   / relay / phone replay attachments share `IZCodeAgentService` and structurally never see this
   channel. **Recorded decision: `IZCodeAgentService` is NOT extended with a workspace-file
   read** — replay clients reach it, so it stays ref-scoped (attachment/conversation/artifact).
   The channel's host-side impl forwards to the v4 method above.
4. **Bridge accessor.** `createBotRemoteWorkspaceService` gains
   `getWorkspaceFileReader({workspacePath, workspaceIdentity})`, reusing the cached
   `getRuntimeServices` port (same lifecycle/failure modes: throws when no attachable route,
   60s init timeout). `createRemoteRuntimeServicesFromPort` wraps the new channel via
   `ProxyChannel.toService`.
5. **Materialization.** Chunks reassemble in memory (≤5MB) → temp file under
   `os.tmpdir()/zcode-bot-outbound/<random>/<filename>`, mode 0600, delivered via the unchanged
   `BotOutboundAttachment.localPath` contract, unlinked best-effort in `finally`. NOT under
   `~/.zcode/v2` (cleanability "none" there; tmpdir is OS-cleanable). Temp files are outside the
   workspace → never re-shareable via `/file` (parity with the inbound cache exclusion).
6. **Failure mapping.** New additive reason `remote-unavailable` (shared enum + CLI mirror +
   zh/en copy) covers: bridge absent, no attachable route, runtime init failure/timeout, old
   remote CLI missing the v4 method, mid-read RPC failure, chunk/total budget exceeded.
   Disconnected remote: `/file` keeps the existing `/重连` hint first
   (`blockDisconnectedRemoteWorkspace` unchanged); tool path returns `remote-unavailable`.
   Remote reader's typed rejections map 1:1 to existing `outside-workspace`/`not-found`/
   `too-large`. `remote-workspace` stays in the enums for old-CLI compatibility but new hosts
   no longer emit it (adapter gate still yields `unsupported-provider` where applicable).
   No auto-reconnect inside delivery (never calls `ensureConnected`).
7. **CLI mirror + prose.** `BOT_SHARE_FILE_FAILURE_REASONS` (contracts) gains
   `remote-unavailable`; CLI tool-result prose gains the case; stale `remote-workspace` prose
   ("not available yet") updated to reflect shipped remote delivery. Old CLI + new host:
   unknown reason fails closed into `send-failed`-style degradation (fail-safe, disclosed).
   Timeout budget: CLI RPC timeout stays 300s; all fetch failures surface as
   `remote-unavailable` far below it.
8. **Audit.** Remote attempts add `remote=<workspaceIdentity>`; `path=` uses the
   workspace-relative path from the RPC result (never a locally resolved path).
9. **Zero drift (local).** Local-workspace `/file` and `share_file` replies are byte-identical
   to `3.14.4-alpha.1` (pinned by regression fixtures). The Alpha 0 `/file` reply-order
   invariant (adapter → remote → empty path) is superseded: adapter gate first, then remote
   branch; empty-path check position unchanged.

### Invariants

- `deliverWorkspaceFile` remains the sole media-delivery entry; remote fetch happens inside it,
  before any adapter call; adapters never learn about remoteness (localPath contract unchanged).
- The machine that owns the filesystem is the ONLY decider of remote path containment; the
  desktop never resolves/realpaths remote paths locally and never trusts a remote absolute path.
- The workspace-file read channel exists only on bot-runtime-marked attachments (structural
  guarantee, not a role heuristic); replay/renderer/phone attachments cannot call it.
- Materialized temp file is the only local artifact: outside workspace + `~/.zcode/v2`, 0600,
  deleted in `finally`; a crash may leak at most one ≤5MB temp file in the OS tmpdir.
- Quota reserve/release semantics identical for remote and local (tool source only).
- All wire additions optional/additive; old remote CLI → typed `unavailable` → surfaced as
  `remote-unavailable`; old host + new CLI unaffected.

### Acceptance scenarios

Unit/integration (services `botFileDelivery.test.ts` + shared zod/policy tests):

1. Remote happy path: fake reader returns 2 chunks → exactly one `adapter.sendAttachment` with
   the materialized temp path; temp unlinked after; audit carries `remote=`.
2. Reader typed rejections map 1:1 (outside-workspace / not-found / too-large); nothing sent.
3. Cumulative >5MB mid-chunk → too-large; chunk deadline / total budget exceeded →
   remote-unavailable; reader missing/init throw → remote-unavailable.
4. Disconnected remote: `/file` → reconnect hint (pinned); tool → remote-unavailable.
5. Zero-drift: local-context `/file` + tool replies identical to pre-Alpha-2 fixtures.
6. Wire schemas strict (unknown keys rejected; limit bounds; absolute `relativePath` →
   outside-workspace); shared path-policy helper matrix (lexical/realpath/symlink escape).
7. Quota parity on remote tool sends incl. parallel reserve/release.

Manual rig (owner pause phase, blocks the alpha release):

1. Local regression: `/file` + conversational share behave exactly as `3.14.4-alpha.1`.
2. Remote happy path: `/file <path>` and "发给我" both deliver the real file from the remote
   workspace; chip survives restart.
3. Trick paths on remote: `../outside.txt`, missing file, >5MB → honest localized refusals.
4. Disconnect the remote machine: `/file` shows the reconnect hint; conversational share
   reports the precise unreachable reason; never fake success.
5. Rapid-fire conversational asks (quota unchanged); temp dir spot check afterwards.
