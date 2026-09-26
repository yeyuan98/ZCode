# Spec: Telemetry & Update-Feed Policy (libre-zcode P0)

Status: implemented-by P0. Owner: desktop main process (`packages/desktop/src/main/index.ts`).

## Behavior

1. **Telemetry = OpenTelemetry only.** The only telemetry shipped is the agent OTLP exporter
   (`apps/zcode-cli/packages/telemetry`), enabled exclusively by `OTEL_EXPORTER_OTLP_ENDPOINT`
   env vars (opt-in, user-supplied backend; OTLP is backend-agnostic).
2. **No vendor telemetry.** Alibaba ARMS RUM (`@arms/rum-electron`) and the 数仓 event pipeline
   (`ZCODE_TELEMETRY_REPORT_ENDPOINT`) are removed, along with every sender, bridge, patch,
   dependency, notice entry, and the desktop `device_mid` persistent identifier.
3. **Update feed disabled while vendor-manifest-wired.** Until the GitHub provider replaces it
   (P5), all three update paths are disabled at the single policy flag
   (`packages/shared/src/updateFeedPolicy.ts`):
   - startup + hourly poll (`initAutoUpdater({enabled})` call site);
   - manual "check for updates" (fail-closed through the same flag, dev-skipped-style result);
   - startup force-update gate (`maybeBlockStartupForForceUpdate` skip).
   Rationale: semver `3.14.3 > 3.14.3-alpha.N`, so the vendor feed would treat every alpha as
   outdated and auto-migrate/hard-block testers onto vendor builds.

## Ownership & invariants

- Single policy owner: `isVendorManifestUpdateFeedWired()` in `updateFeedPolicy.ts` (shared,
  pure, no IO). Desktop main is the only consumer. P5 flips it to `false` by deleting the
  vendor provider and the flag, which re-enables updates via the GitHub provider.
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
