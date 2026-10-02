# Bots Module Contract

Chat-bot control of Zodex agent sessions (WeChat / Telegram / Feishu-Lark / webhook):
inbound command + message handling, conversational task driving, bidirectional file
delivery, and the bot-scoped remote-workspace bridge.

## Public surface

Two entrypoints, both declared in `architecture-policy.yaml`:

- **`contract.ts` — browser-safe sub-contract**: service descriptors + types only
  (`IBotsService` + param/result types, `IBotWorkspaceFileService`,
  `IBotShareFileForwardService`, `BotWorkspaceFileV4Forwarder`,
  `BotShareFileForwarder`). This is what the package root `index.ts` re-exports for
  renderer/browser consumers — it MUST NOT re-export any `create*` factory (they
  statically import `node:*` builtins and provider adapters).
- **`contract.node.ts` — Node assembly** (re-exports everything in `contract.ts`
  plus the factories): `createBotsService` (window-Host service assembly; owns the
  inbound loop, command admission, the `/file` single writer
  `deliverWorkspaceFile`, `taskDeliveryRegistry`), `createBotRemoteWorkspaceService`
  (bot remote-workspace bridge), `createBotWorkspaceFileService`,
  `createBotsShareFileExecutor`, `createBotShareFileForwarder`,
  `createDesktopBotShareFileForwardService` (remote file read + share-file forward
  channels). The package `node.ts` re-exports `createBotsService` and the three
  share-file factories; the rest are consumed internally by the node assembly.

Production code imports bots capabilities only through these entrypoints (package
root `index.ts` / `node.ts`). Tests may import bots internals directly (same
precedent as the session module's tests).

## State owners

- Bot configs + per-bot context/draft state: bots service via the bot state repo
  (`repo.ts`, persisted under the services storage domain).
- `taskDeliveryRegistry` (taskId → delivery target): in-memory, host-side only,
  populated exclusively at conversational watch sites; single writer for outbound media.
- Inbound attachment cache: `~/.zcode/v2/bot-attachments/<botId>/...` (desktop-side).

## Dependencies

Cross-package: `@zcode/shared`, `@zcode/rpc`, `@zcode/provider`, plus Node builtins
(fs/crypto/path/buffer/os — Node assembly only). Intra-package (within the `services`
module boundary): session task service, credential, setting, broadcast, zcode-agent,
model-provider facade, logger, paths, descriptors. Declared `requires` in the
architecture policy lists the cross-package set.

## Specs

Behavior, invariants, failure semantics: `specs/bot-file-delivery.md` (file delivery),
`specs/bot-provider-network.md` (provider egress/proxy). Process lessons:
`../ZCode-handoff.md` §5.
