# Spec: Off-Peak Local Admission & Unattended Execution (libre-zcode P3)

Status: planned (P3). Owners: desktop main process (admission evaluation + settings + wake
timer); services host (dispatch + interaction auto-decline); scheduler utility process
(claim loop); task database (`off_peak_tasks`) owned by `packages/services` repos.

## Behavior

1. **Admission is local and time-window-only.** A queued off-peak task may be claimed for
   dispatch iff `withinWindow(now, settings)` is true. The window is a daily local-clock range
   (default `00:00–07:00`); the user may disable the window ("any time"). If `start > end`
   the window wraps past midnight (e.g. `22:00–07:00`). Daylight-saving shifts shorten or
   lengthen the effective window naturally; no calendar math beyond minute-of-day.
   **Rejected alternatives (recorded):** system-idle detection and AC-power detection were
   considered and rejected for simplicity (ruling 1, 2026-09-27). The topology (scheduler asks
   main) leaves room to add them later without re-plumbing.
2. **"Run now" override.** A user-triggered "Run now" action on a queued/paused task forces
   dispatch immediately, bypassing the window. It is a no-op if the task is already being
   claimed (`claim_running = 1`). It does NOT change the interaction policy below.
3. **Run-to-completion.** Once dispatched, a run is never aborted or requeued because the
   window closed or time passed. Restart recovery re-queues interrupted runs (existing
   behavior, kept).
4. **Execution on the user's own provider.** Dispatch uses the task's persisted
   `model_selection` (any user-configured provider). No special auth, no fixed vendor model
   view, no gray-release enablement gate. Eligibility to CREATE a task = at least one
   configured provider with a persisted selection.
5. **Unattended runs are hands-off (binding policy, ruling 2).** While an off-peak task's turn
   is the session's active turn, every reverse-RPC interaction is automatically declined:
   permission requests → deny; `AskUserQuestion` → declined; exit-plan-mode approval →
   declined. The run then completes with a "blocked by interaction" outcome recorded on the
   task. Attribution is strictly turn-based; there is no presence/idle detection, and no
   exception for watched runs (including "Run now" — interactive needs are served by normal
   tasks). The `OffPeakCreate` agent tool's default permission mode changes `yolo` → `build`
   (same as the UI form default).

## Rationale (why hands-off)

- An unattended run that hits a question would otherwise wait forever — the worst outcome
  (silent hang, no notification, held resources).
- Denial is recoverable and visible: the task terminates with a reportable "blocked" outcome;
  the user re-runs or adjusts and retries.
- "User is watching" detection is unreliable (no robust presence signal exists) and would
  create a semantics split between attended and unattended runs of the same task type.
- Risk containment: `yolo` as a tool default invites unattended full-auto behavior the user
  never explicitly chose; `build` matches the UI default and is the conservative choice.

## Ownership & event order

```text
CREATE (UI form / OffPeakCreate tool; services OffPeakTaskService)
  → resolveModelSelection = user's persisted choice → repo.create(queued) — NO ticket, NO schedulable column
ADMISSION (main process, per scheduler request)
  scheduler tick (20 s) → correlated req/id on schedulerProtocol → main: withinWindow(now, settings)
  main also arms a timer to next window-open → cronScheduler.wake()   (settings stay single-ownered in main)
DISPATCH (scheduler utility process)
  claimDue: status='queued' AND claim_running=0 ORDER BY queued_at  (admission checked BEFORE claiming)
  → unchanged 3-branch plan (resume | bound-first-run | init) → host
RUN (window-scoped Host)
  per-turn modelSelection flows scheduler→host→sendPrompt (existing); requestAuth injection DELETED
  interaction auto-decline active while the off-peak turn is the session's active turn
SETTLE (host → repo)
  markRunning / markTerminal as today; no server settle, no outbox, no retake
```

## Settings schema

One new AppSettings group (validated in `validationAppSettings.ts`, transported via
`protocol.ts`): `offPeakWindow: { enabled: boolean; start: "HH:mm"; end: "HH:mm" }`,
defaults `{ enabled: true, start: "00:00", end: "07:00" }`. `enabled: false` = schedulable at
any time. Rendered only in Settings → Automations (idle tab). UI copy states that questions
are auto-declined during unattended runs.

## Persistence (hard-cut)

- `off_peak_tasks` loses the six vendor-ticket columns (`server_ticket_id`, `registered_at`,
  `schedulable`, `queue_position`, `next_poll_at`, `settled_at`) from
  `tasksDatabase/schema-v1.ts`; **no index changes** (`idx_off_peak_pick(status,queued_at)`
  still serves the claim scan). The `0001_adopt_task_schema` checksum input (which embeds the
  schema string) changes in the SAME commit. Consequence: databases created by alphas 1–6
  fail with `checksum_mismatch` on open — accepted under the no-migration alpha policy;
  release notes state the reset requirement.
- `next_poll_at` was write-only (nothing scheduled on it) — no replacement needed.
- The `schedulable` concept moves from stored server state to claim-time evaluation.

## Test scenarios (minimum)

- Window matrix: boundaries (start/end inclusive-exclusive pinned in tests), wrap-past-midnight,
  DST-shift day, `enabled:false`, Run-now bypass, run-to-completion when window closes mid-run.
- Lifecycle: create → claim → dispatch → settle against a fake provider (temp sqlite).
- Auto-decline: permission / AskUserQuestion / plan-approval each declined during a tracked
  off-peak turn; a non-off-peak turn in the same session unaffected.
- Run-now race: `claim_running=1` → no-op, no double dispatch.
- Restart recovery: interrupted running → queued; zombie-claim reclaim.
- Fresh DB: schema has no ticket columns; migration checksum matches schema string.
- Desktop `desktop-continuous` delivery semantics asserted unchanged (web
  `web-remote-replayable` path untouched).
- Scheduler integration harness drives the real scheduler module through a port-injection seam.

## Expected-death list (off-peak slice)

`offPeakServerClient.ts`, `offPeakMockGateway.ts`, `offPeakModelSelectionView.ts`,
CLI `offpeak-retry.ts`, JWT/plan-key/team-header machinery + mock origin resolver in
`offPeakRuntimeModel.ts`, protocol `requestAuth` field + `ModelRequestAuth` contract + CLI
freeze + header redaction, `OFF_PEAK_PROVIDER_IDS` / plan-support / take-number / ticket-state
types, vendor errorCategory `3101/3103` handling, queue-position UI badges, gray-config
eligibility gates.
