# Spec: Bot Provider Network Transport, Observability, Cursor Persistence (Alpha 6)

Status: **Spec'd 2026-10-02 from the owner-approved incident postmortem (all decisions FINAL,
owner-approved 2026-10-02); implementation pending; targets `3.14.4-alpha.6`.**
Production incident 2026-10-01/02: the owner rig (mainland-China network) could not bind a
Telegram bot — the desktop UI showed the generic "Bot connection failed"
(`bots.runtime.connectionFailed`) and bind was blocked. Root cause PROVEN on a live rig (real
`createBotsService` + real long-polling, run off-repo with a real BotFather token): bot
provider networking uses Node's global `fetch`, which ignores proxies entirely; on GFW
networks `api.telegram.org` is DNS-poisoned/blackholed, so EVERY bot HTTP call to Telegram
times out (undici `ETIMEDOUT`) while curl/Telegram-clients (proxy-aware) succeed.
Feishu/WeChat are unaffected (domestically reachable). A live rig with the proxy honored via
`NODE_USE_ENV_PROXY=1` completed the FULL chain: long-poll started, queued updates processed,
`/bind` succeeded, `/file` delivered files incl. a subfolder path — the product logic was
already correct; only the network path was broken. Alpha 5 was exonerated. Secondary findings
fixed in the same alpha: poller errors are swallowed unlogged (`telegramChannelRuntime.ts`'s
catch-all discards the error object; statusSink writes an in-memory map only), the UI renders
one generic label for every telegram/weixin error and hides the detailed reason, add-bot
proceeds despite unreachable tokens (resolveName failure is warn-only), the Telegram command
menu never re-syncs after connectivity recovery, and two cursor writers can silently drop
their write.
Owners: bot provider request module (`packages/services/src/bots/providers/providerRequest.ts`)
— injectable requester factory; bots service (`botsService.ts`) — `providerFetch` seam +
cursor persistence; channel runtimes (`telegram/weixin/feishuChannelRuntime.ts`) — error
observability + self-heal; desktop host (`packages/desktop/src/host/index.ts`) +
attached-remote collection (`remoteWorkspaceServiceCollection.ts`) — transport composition;
UI (`packages/ui/src/BotsDialog`) — error detail surfacing.
Related: specs/bot-file-delivery.md (Alpha 0–5 delivery chain — untouched above the adapter
network path), `packages/services/src/providers/api/nodeApiNetwork.ts` (the host API network
transport being reused).

## Behavior (F1 — bot provider network transport: the core fix)

1. **All bot provider HTTP traffic goes through an injectable fetch.** `providerRequest.ts`
   exports a requester factory — `createBotProviderRequester(fetchImpl = globalThis.fetch)` —
   returning the existing three bounded helpers (`fetchBotProvider`, `fetchBotProviderJson`,
   `fetchBotProviderWithHeaders`); no module-level mutable globals; the module stays
   fetch-agnostic and Electron-agnostic.
2. **Injection seam.** `BotsServiceDeps.providerFetch?: typeof fetch` (same test-injection
   style as `providerOverrides`). Threaded to the four provider factories
   (telegram/weixin/feishu/webhook), the telegram channel runtime (deleteWebhook), and it
   replaces the 5 raw `fetch` escape hatches: telegramProvider getFile + file download
   (~548, ~562), weixinProvider CDN download (~1086), feishuProvider resource download
   (~2009), webhookProvider (~116).
3. **Composition — one proxy setting, zero new UX.** The desktop host passes the EXISTING host
   API network transport's fetch (settings-UI `httpProxy` → undici `ProxyAgent` dispatcher;
   `nodeApiNetwork.ts` `createHostApiNetworkTransport`), so ONE proxy setting covers AI +
   bots. Attached-remote collection passes its transport when present, else global fetch.
   Reuse the TRANSPORT, not the `ZCODE_HTTP_PROXY` env var (that is agent-subprocess env;
   review finding). Event order:

   ```text
   Zodex settings httpProxy (the ONE existing proxy setting — no new UI)
     └─ desktop host createHostApiNetworkTransport (nodeApiNetwork.ts)
          ├─ AI/API client egress (existing, unchanged)
          └─ createBotsService deps.providerFetch = transport fetch   ← Alpha 6 wiring
               └─ createBotProviderRequester(providerFetch)
                    └─ ALL bot egress: long-poll getUpdates, sends, uploads, downloads,
                       webhook calls, deleteWebhook, setMyCommands
   attached-remote collection (remoteWorkspaceServiceCollection.ts):
     its own transport when present, else global fetch (no desktop host in that assembly)
   ```

4. **Semantics.** No proxy configured → direct fetch, behavior byte-identical to alpha.5
   (zero drift). Transport disposed → requests fail closed with a structured error (NEVER
   silently fall back to direct — a fallback would exfiltrate traffic outside the configured
   proxy). Documented non-goal: env-var auto-pickup (`NODE_USE_ENV_PROXY`) is experimental
   and NOT adopted; users configure the app proxy setting once. Recorded decision — do not
   re-litigate.

## Behavior (F0 — failures name themselves)

1. **The telegram poller's catch-all binds and logs the real error** (cause survives: e.g.
   "fetch failed/ETIMEDOUT", HTTP status). All three runtimes log transitions INTO error
   status with the detailed message (`createServiceLogger("bots")` warn).
2. **UI surfaces the detailed runtime message for ALL providers on error.** Today only
   feishu/lark have an error detail panel (ProviderSettingsCard gates it on `isFeishuLike`;
   BotSummaryCard renders the generic label). Keep the generic label as the summary, the
   detail as a secondary line/tooltip.
3. **Add-time fail-fast.** When saveBot's resolveName (getMe etc.) fails on a
   credential-bearing save, the add flow surfaces the failure (the wizard must not sail
   through an unreachable token with only a warn).

## Behavior (F0b — self-heal)

When the telegram runtime transitions error→polling (connectivity recovered), re-run
`syncCommands` so the command menu stops staying empty until restart.

## Behavior (F4 — cursor writes never silently dropped)

`writeTelegramOffset` and `writeWeixinGetUpdatesBuf` (botsService) currently no-op when no
state entry exists AND `firstAllowedWorkspace` resolves no workspace — the cursor is lost and
one update batch reprocesses forever (duplicate replies every poll). Both always persist:
create/extend the state entry without requiring a resolvable workspace (workspace fields may
be empty until first use). Red-test-first.

## Invariants

- Single writer/data-owner rules unchanged; `deliverWorkspaceFile`, quota, registry
  untouched.
- WeChat + Feishu behavior byte-identical when no proxy is configured (zero drift, pinned by
  existing fixtures).
- Proxy routing covers ALL bot-provider egress (polling, sends, uploads, downloads, webhook
  calls, deleteWebhook, setMyCommands) — no raw-fetch escape hatch remains in
  `packages/services/src/bots`.
- Fail-closed on transport disposal; never direct-fallback under a configured proxy.
- Cursor persistence is unconditional (no silent drops).
- No secrets in logs (tokens never logged; proxy URLs may be logged without credentials).

## Acceptance scenarios

Unit/integration:

1. providerRequest factory: injected fetch used by all helpers; default = global fetch.
2. All five former raw-fetch sites route through the injected fetch (fetch-stub counting;
   incl. telegram getFile + file download + deleteWebhook).
3. No-proxy composition → direct fetch object identity/behavior unchanged.
4. Disposed transport → structured failure, zero direct fallback calls.
5. Poller error → log line carries the cause; status transition logged.
6. UI error detail present for telegram/weixin.
7. resolveName failure at add → surfaced to the add flow.
8. error→polling transition triggers syncCommands exactly once per recovery.
9. Red tests: cursor persists when no state entry + no workspace (both writers); no infinite
   reprocess.
10. Zero-drift: existing weixin/feishu suites unmodified and green.

Manual rig (blocks release): set proxy in Zodex settings (owner's local proxy address) →
restart → telegram bind succeeds → `/file` + conversational share deliver → command menu
appears (self-heal) → WeChat/Feishu regression pass → unset proxy → detailed error visible
in UI + logs (no generic-only).
