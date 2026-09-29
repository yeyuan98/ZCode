# Spec: Bot Outbound File Delivery (Alpha 0 — WeChat `/file`)

Status: implemented-by Alpha 0 (branch agent/coder/bot-file-delivery-alpha0-weixin; first alpha of
the 3.14.4 train per docs/versioning.md). Full-feature playbook in ../ZCode-handoff.md.
Owners: bots service (`packages/services/src/bots/botsService.ts`) — command admission, path
policy, size gates; weixin provider adapter (`providers/weixinProvider.ts`) — CDN upload +
media sendmessage; bot state repo (`repo.ts`) — per-peer context_token persistence.
Related: `docs/versioning.md` (patch 3.14.4 = full bidirectional file sync).

## Behavior

1. **New authorized bot command `/file <path>` (aliases `/文件`).** Only in private chats
   (`chatType === "private"`), only for providers whose adapter implements `sendAttachment`
   (Alpha 0: weixin only). Other channels get a localized "not supported yet" reply.
2. **Path policy: workspace-only.** The requested path is resolved against the bot context's
   active workspace root. Paths escaping the workspace tree (after resolving `.`/`..` and
   symlinks via `realpath`) are rejected with a localized notice. Absolute paths inside the
   workspace are accepted. The `~/.zcode/v2/bot-attachments` cache is NOT in scope for Alpha 0
   (it lives outside the workspace; revisit in a later alpha with an explicit allowlist).
3. **Size/count gates: ≤ 5MB, 1 file per command** (symmetric with inbound
   `BOT_MAX_ATTACHMENT_SIZE_BYTES`). Oversize → localized rejection listing the limit.
4. **Remote workspaces: honest guard.** If the context workspace is remote
   (`workspaceIdentity` set), `/file` replies that remote-workspace delivery arrives in a
   later alpha; it never pretends success and never reads local paths for a remote context.
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

## Invariants

- Bot message text replies, typing indicators, permissions, and task lifecycle behave
  exactly as before this change (zero modification to the existing text `send()` path).
- `/file` does not create, resume, or mutate tasks; it is a pure side-channel command.
- One writer for outbound attachments: `sendOutbound` remains the only delivery entry; the
  media path is an extension of the adapter contract, not a second queue.

## Acceptance scenarios

1. `/file relative/path/result.png` in an active local workspace → WeChat receives an image
   message that opens on the phone.
2. `/file ../outside.txt` or an absolute path outside the workspace → localized rejection.
3. `/file big.bin` (>5MB) → localized rejection with the limit.
4. Missing file → localized rejection.
5. Telegram/Feishu bot `/file` → "channel not supported yet" text.
6. Remote workspace context → "later alpha" text.
7. Stale session (no recent inbound): send fails → retry-without-token → text fallback notice.
8. All existing bot behavior unchanged (regression: run bots-related flows).
