# Spec: Telemetry & Update-Feed Policy (libre-zcode P0)

Status: implemented-by P0. Owner: desktop main process (`packages/desktop/src/main/index.ts`).

## Behavior

1. **Telemetry = OpenTelemetry only.** The only telemetry shipped is the agent OTLP exporter
   (`apps/zcode-cli/packages/telemetry`), enabled exclusively by `OTEL_EXPORTER_OTLP_ENDPOINT`
   env vars (opt-in, user-supplied backend; OTLP is backend-agnostic).
2. **No vendor telemetry.** Alibaba ARMS RUM (`@arms/rum-electron`) and the 数仓 event pipeline
   (`ZCODE_TELEMETRY_REPORT_ENDPOINT`) are removed, along with every sender, bridge, patch,
   dependency, notice entry, and the desktop `device_mid` persistent identifier.
3. Update feed: vendor-manifest guard superseded by P5.\*\* The P0 three-path disable (flag
   `packages/shared/src/updateFeedPolicy.ts`) was a transitional guard for the vendor manifest
   feed: semver `3.14.3 > 3.14.3-alpha.N`, so the vendor feed would treat every alpha as
   outdated and auto-migrate/hard-block testers onto vendor builds. P5 deletes the vendor
   provider, the force-update gate, AND the flag (see
   `specs/distribution-and-updates.md` §A for the replacement design: GitHub provider, single
   `latest.yml` channel, allowPrerelease floor rule — the floor clause was later revoked by
   the P8 修订 in that spec). This section is retained as history; the live update policy lives
   in `specs/distribution-and-updates.md`.

## Ownership & invariants

- ~~Single policy owner: `isVendorManifestUpdateFeedWired()`~~ — deleted in P5 together with
  the vendor provider and its test; update policy ownership moved to
  `specs/distribution-and-updates.md`.
- No telemetry module may write a persistent machine identifier; CLI OTel's anonymous in-memory
  identity is exempt (per-plan decision, kept).
- Failure semantics: disabled update paths return a benign "disabled" result — never an error
  toast, never a network call to `zcode.z.ai`.

## Migration boundary

Fresh start: no data migration. Scope of the device-identity removal is **desktop-main telemetry
paths**: desktop no longer reads or writes `~/.zcode/v2/telemetry-state.json`, and no desktop code
sends a persistent machine identifier to vendor endpoints. Known residuals that die in later
phases: `services/src/providers/sourceHeaders.ts` still reads a stale `telemetry-state.json` if
present (self-extinguishes; removed with vendor headers in P4); the self-hosted server stdio
device id (`services/src/device/deviceMid.ts`) is not vendor telemetry and stays; the CLI OTel
identity persists locally **only when the user opts in** via `OTEL_EXPORTER_OTLP_ENDPOINT`
(corrected: it is persisted, not in-memory, when enabled).
