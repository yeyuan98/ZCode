# Spec: Bot Outbound Message Delivery Reliability (3.14.5 Alpha 1)

Status: **IN FLIGHT — 3.14.5-alpha.1**. Owner-reported (2026-10-02, on 3.14.5-alpha.0 but
PREEXISTENT and code-confirmed): bot session messages get stuck on the desktop and arrive
late or only after the user sends another message; frequently MULTIPLE messages arrive as
ONE bubble concatenated with no separator; persistent "typing"; tight repro on
Feishu/Telegram — `/status` right as a job completes makes the completion message stick
until `/stop` plus another message dumps everything glued together. WeChat shows
stuck/concatenated behavior most on long tasks. Seven root causes (stale watcher orphan,
serial-queue + snapshot-first terminal handler, extract-before-send loss, WeChat text-send
token gap, Feishu card circuit never resets, interaction boundaries don't flush, silent
provider drops) are code-confirmed in the handoff (ZCode-handoff.md §2 Alpha 1).
Owners: bots service reply pipeline (`packages/services/src/bots/botsService.ts`) —
buffer/flush/drain/typing/terminal ordering (this spec); provider send contracts, token
behavior, cursor notes live in `specs/bot-provider-network.md` (single-owner split,
cross-referenced both ways).
Related: `specs/bot-file-delivery.md` (attachment delivery chain — untouched here),
`specs/bot-provider-network.md` (WeChat text token parity amendment, Alpha 1 section).

## Scope note

This spec owns REPLY-PIPELINE semantics ONLY: buffer boundaries and force-flush sites, the
single drain owner, the lossless-flush contract (incl. budget), terminal ordering, typing
lifecycle, and observability events. Provider-level send contracts (WeChat ret=-2
token-less retry, request timeouts, Telegram/Feishu honest failures) amend
`specs/bot-provider-network.md`.

## Behavior (F1 — single drain owner)

1. **One `disposeTaskWatcher` drain helper** replaces the three partial cleanups. For a
   workspace+task watcher it performs, in order:
   1. force-flush the pending assistant reply buffer as its own message (per the F2
      contract);
   2. clear the live-status progress entry for the task;
   3. stop typing for the task — OUTSIDE the serial `streamEventQueue` (the drain runs
      directly, never enqueued, so a parked queue cannot delay it);
   4. unsubscribe the stream subscription and remove the watcher registration.
2. **Call sites (exhaustive)**: the terminal handler (replaces its inline unsubscribe),
   `/stop` (ordered: `stopGeneration` → drain → the existing status reply), the
   stale-cleanup in `isContextActiveTaskRunning` (persisted status is terminal but the
   in-process running flag never cleared), and service dispose. Disposal reasons are
   logged (`terminal|stop|stale|dispose`). `taskDeliveryRegistry.forget` at those sites
   keeps its existing placement (Phase B semantics unchanged).
3. **Fresh watcher invariant**: after a drain, the next `watchTaskStream` for the same
   workspace+task MUST create a FRESH watcher closure (the existing-subscription guard
   finds no entry). A stale watcher must never be silently reused.
4. **Decided `/stop` semantics (owner §4.7)**: `/stop` delivers the AI's partial reply
   immediately as its own message (as-is — it is already visible in the desktop UI;
   discarding it is information loss, holding it hostage was the stuck-message bug),
   then `/stop`'s status reply; the late terminal notice is REPLACED by it. No timers.
5. **Cross-chat stale closure**: because the watcher key is workspace+task, a watcher
   whose task is persisted-terminal but whose terminal event was lost replies to the OLD
   chat forever; the stale-cleanup drain now removes it, so the next chat's
   `watchTaskStream` binds a fresh watcher to the NEW actor.

## Behavior (F2 — lossless bounded flush)

1. `flushAssistantReplyBuffer` sends chunk-wise and advances the buffer ONLY past
   successfully sent chunks (trim-on-success). It never re-prepends failed text into a
   retry-on-every-event loop.
2. **Per-invocation budget**: at most 2 send attempts per failing chunk with a single
   ~1s backoff sleep between attempts; because the FIRST failing chunk drops the
   remainder and returns, at most one chunk per invocation burns the budget. The
   structural bound: cumulative added SLEEP ≤~1s per invocation; wall-clock is bounded
   by 2× the provider send timeout (15s explicit on WeChat text) plus one notice send.
   A poison message can never wedge the serial event queue.
3. **Final failure**: on budget exhaustion the remainder (unsent chunks + unsent buffer
   tail) is DROPPED and a localized notice (`replyDeliveryFailed`, zh/en) is sent via a
   catch-wrapped `sendOutbound` plus a warn log. The notice fires at most once per failed
   flush invocation. Decided semantics: drop-with-notice, NOT retain-for-next-boundary —
   a poison remainder must not linger.
4. Non-forced flushes keep today's semantics: they only normalize the buffer; extraction
   (and thus any send) happens at force boundaries.

## Behavior (F3 — interaction-boundary flush)

On `permission_request` and `elicitation_request`, non-streaming-card providers
force-flush the buffer BEFORE the prompt message is built and sent — mirroring where
card providers call `sealStreamingCardReply` at the same sites. Pre-question text must
never glue onto post-answer text.

## Behavior (F5 — Feishu circuit reset + guaranteed final render)

1. A successful card sync resets `streamingCardCircuitOpen` and the failure counters
   (closes the circuit); transitions are logged (F10).
2. The FINAL terminal card sync — `task_complete` AND `task_error` — always attempts
   once even with the circuit open (half-open), so a terminal task cannot stay frozen
   on a "Running" card.
3. If that final render fails, degrade honestly: the completion content (change-summary
   messages; "task completed" fallback when nothing was ever delivered) — or the
   localized failure notice for `task_error` — is sent as normal text messages via the
   standard reply path, with a warn log. No retry storm: the degrade is one-shot per
   terminal event.

## Behavior (F7 — completion text first, paperwork second)

The terminal handler force-flushes the assistant reply buffer BEFORE `readTerminalTaskMeta`
and `getTaskSnapshot` (the paperwork that contends with `/status` RPCs on a
just-finishing session). Change-summary messages send unchanged and may arrive as a later
bubble. **Timing-only change vs 3.14.4**: message content and message boundaries are
unchanged; only the send order of body text vs change summary vs terminal paperwork moves.
Nothing else in the terminal handler is reordered.

## Typing lifecycle

- Typing starts at watcher creation and stops at watcher drain (inside `disposeTaskWatcher`)
  or at interaction boundaries as today. `/stop` clears typing immediately even when the
  serial event queue is parked — the drain call is never enqueued.
- **Same-process-only caveat (documented deferred decision)**: the Feishu typing-reaction
  handle lives in an in-memory map; an app restart can leave a stale typing reaction in
  the Feishu client until its own TTL. Out of scope for this alpha (owner: accepted).

## Serial event queue contract

- `enqueueStreamEvent` serializes per-task stream events and NEVER rejects: handler errors
  are caught and downgraded to warn logs. This contract is unchanged and now load-bearing:
  with F2's bounded flush, no provider failure can park the queue for more than the flush
  budget; a parked queue also cannot delay `/stop`'s drain or typing clear (F1).

## Observability (F10)

Info logs (service logger `bots`, no file paths/secrets): forced flush (taskId, chunk
count, bytes), watcher create/dispose (reason `terminal|stop|stale|dispose`), Feishu
circuit transitions (open/reset/half-open-final), WeChat token-less retry fired. Warn
logs: F2 drop path, F5 degrade path, notice-send failure. Debug stays reserved for raw
protocol data (unchanged).

## Invariants

- One drain owner: only `disposeTaskWatcher` unsubscribes watchers (terminal/stop/stale/
  dispose); `watchTaskStream` only registers. Sole exception: the service-dispose sweep
  fires all drains best-effort and then clears both maps synchronously (shutdown must
  not be delayed by send chains).
- The drain is never enqueued onto `streamEventQueue`.
- The flush budget is bounded per invocation by construction (first failing chunk drops
  the remainder: ≤2 attempts + one ~1s backoff sleep; wall-clock ≤ 2× send timeout +
  one notice send).
- Provider parity: text providers flush at interaction boundaries; card providers seal
  (unchanged); `summary_changes` never streams (unchanged).
- No new timers; no new background processes; no polling.
- Reply-pipeline behavior for streaming_card and summary_changes modes is byte-identical
  except where F5 explicitly amends the final render.
- Known future work (recorded, not this alpha): memoize the per-send persisted-token
  state read for weixin outbound bursts; consider invalidating the persisted weixin
  token after a successful ret=-2 token-less retry (today a stale persisted token keeps
  every send two-request until the next inbound ping).

## Acceptance scenarios

Unit/integration (red-first; harness patterns from botFileDelivery/botInboundAttachments —
fake task service with captured stream enqueue, providerOverrides adapters):

1. **Stale-watcher drain via `/stop`**: buffer holds partial text → `/stop` → partial text
   arrives as its own message BEFORE any next inbound message; typing cleared;
   subscription removed (next `watchTaskStream` creates a fresh watcher with a NEW
   enqueue); `/stop`'s status reply follows. Red today: `/stop` leaves the buffer held;
   the next message dumps old+new glued.
2. **Poison chunk budget**: a send that always fails cannot delay subsequent queued events
   beyond the F2 budget (≤2 attempts + ~1s backoff); remainder dropped; one
   `replyDeliveryFailed` notice; queue continues.
3. **Trim-on-success**: first chunk send succeeds, second fails twice → first chunk
   delivered, second dropped with notice, no re-send of the first on later events.
4. **Boundary flush at permission (text providers)**: buffered pre-question text is
   delivered as its own message before the permission prompt message.
5. **WeChat text ret=-2 retry + persisted-token read** (fetch-mocked provider tests):
   text `/sendmessage` retry without `context_token` on ret=-2; text send carries an
   explicit 15s timeout; stream-path text sends read the freshest persisted token
   (fallback to captured actor token) for weixin actors.
6. **Feishu circuit reset + final half-open render + text degrade**: success closes an
   open circuit; final `task_complete` sync attempts with the circuit open; final-render
   failure degrades to normal text completion. `task_error` terminals get the SAME
   half-open attempt + degrade to the localized failure notice.
7. **Telegram fallback checked**: Markdown send fails AND fallback plain-text send fails
   → throw naming both statuses; missing token in Telegram/Feishu `send` → throw (no
   silent return), no retry machinery, no notice-over-broken-channel.
8. **Completion-text-before-snapshot ordering**: slow `getTaskSnapshot`/meta reads cannot
   delay the completion body text (text bubble observed before snapshot resolves).
9. **Cross-chat stale-closure regression**: task persisted-terminal + stale watcher armed
   for chat A; chat B resumes the task → replies go to chat B's actor.

Manual rig (blocks the alpha): WeChat task >40 min with NO inbound → completion arrives;
`/status` sent right at completion → completion text arrives promptly and as its own
message (no glue, no stuck); `/stop` mid-reply → partial text arrives immediately, typing
stops; Feishu card survives 3 transient update failures and completes; no concatenated
multi-message bubbles anywhere; logs show flush/dispose reasons.

## Deferred decisions (recorded, NOT this alpha)

- **WeChat batch-cursor rescope (owner §4.8, alpha.2)**: per-message commit is
  protocol-infeasible (ONE marker per batch); committing early acks unprocessed messages
  (silent loss). The sound rescope is skip-failing-message-with-notice + commit; decision
  note lives in `specs/bot-provider-network.md` (F4 cursor section), design lands in
  alpha.2. Do not implement here.
- **Feishu typing-reaction surviving app restarts**: out of scope (same-process only).
