# Bots Module Contract

Chat-bot control of Zodex agent sessions (WeChat / Telegram / Feishu-Lark / webhook):
inbound command + message handling, conversational task driving, bidirectional file
delivery, and the bot-scoped remote-workspace bridge.

## Public surface (see `contract.ts`)

- **Browser-safe**: service descriptors + types (`IBotsService`,
  `IBotWorkspaceFileService`, `IBotShareFileForwardService` and their param/result
  types). Re-exported through the package root `index.ts`.
- **Node assembly**: `createBotsService` (window-Host service assembly; owns the
  inbound loop, command admission, `/file` single writer `deliverWorkspaceFile`,
  `taskDeliveryRegistry`), `createBotRemoteWorkspaceService` (bot remote-workspace
  bridge), `createBotWorkspaceFileService` / `createBotShareFileForwarder` /
  `createBotsShareFileExecutor` / `createDesktopBotShareFileForwardService`
  (remote file read + share-file forward channels). Re-exported through `node.ts`.

## State owners

- Bot configs + per-bot context/draft state: bots service via the bot state repo
  (`repo.ts`, persisted under the services storage domain).
- `taskDeliveryRegistry` (taskId → delivery target): in-memory, host-side only,
  populated exclusively at conversational watch sites; single writer for outbound media.
- Inbound attachment cache: `~/.zcode/v2/bot-attachments/<botId>/...` (desktop-side).

## Dependencies

`@zcode/shared` (types, protocol, i18n catalogs) and `@zcode/rpc` (descriptors,
channels) only. Consumers must not import `bots/*` internals directly.

## Specs

Behavior, invariants, failure semantics: `specs/bot-file-delivery.md` (file delivery),
`specs/bot-provider-network.md` (provider egress/proxy). Process lessons:
`../ZCode-handoff.md` §5.
