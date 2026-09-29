# Rebrand to Zodex & Final 3.14.3 Release (P7)

Status: implemented (design of record below; amendments recorded in-phase).

## Goal

Ship the vendor-purged fork under the name **Zodex** and release final **3.14.3** from the renamed repos, adding macOS and Linux desktop installers to the existing Windows pipeline.

## Locked decisions

- **D1 Repos**: `yeyuan98/ZCode` → `yeyuan98/zodex`; `yeyuan98/zcode-plugins` → `yeyuan98/zodex-plugins`. Renamed BEFORE code changes so the final release bakes resolving URLs. GitHub redirects old URLs (web/git/release assets); old `raw.githubusercontent.com` paths keep serving (same-owner rename). Plugin catalog regenerated from `build.mjs` URL constants (marketplace.json is generated output); plugin zips untouched (hashes stable, no re-upload).
- **D2 Product identity renames this release**: productName `Zodex`, appId `dev.zodex.app`, Linux binary/package `zodex`, artifact names `Zodex-3.14.3-<plat>-<arch>[.ext]`. Version stays 3.14.3 (no Zodex release ever shipped; code is functionally 3.14.3). Casing convention: display name + Windows/mac artifact names `Zodex`; Linux command and dpkg package `zodex`; env vars `ZCODE_*`, protocol `zcode://`, CLI binary `zcode`, package names `@zcode/*` unchanged.
- **D3 Old alphas get zero compatibility code** (user directive): no blocking, no feed changes, no migration. Release note tells alpha users to install fresh. Expected default behavior: alpha updaters offer 3.14.3; the Zodex installer installs side-by-side with the old ZCode app (different appId/install dir/uninstall entry); desktop app data dir resets `ZCode` → `Zodex`; CLI `~/.zcode/` data survives.
- **D4 UI/CLI brand strings rebranded**: case-sensitive value-only `ZCode` → `Zodex`; locale keys unchanged; lowercase technical tokens inside values untouched (`x-zcode-bot-secret`, `.zcode/v2`, `.zcodeignore`, `zcode` CLI). Compound rules: `ZCode Agent` → `Zodex Agent`; `ZCode CDN` → `Zodex CDN`. Coupled string matches (zcodeUiError ↔ conversationProjectionStore retry detection) change in the same commit.
- **D5 Logo = Option B** (user pick): warm ivory background `#F5F3EE`, glyph `#17181A`. Produced by luminance remap of the existing 1024 master (geometry/alpha/AA preserved). Applied to: desktop icon set (ico/icns/pngs ×2 trees: `packages/desktop/build*`, `public/logo/icons`), installer icons, `icon_windows.png`, `public/icon_512@2x.png`, web favicon.ico + inline data-URI favicon in `packages/web/index.html`, in-app SVG logo (`logo-zai.svg`, filename unchanged), dmg background (recolor + wordmark replaced with "Zodex"). Unused brand assets (`logo-zai-square.svg`, `ZCodeWordmarkLogo`) deleted after usage verification. `Z.svg` watermark and currentColor Z glyphs stay (Z is valid for Zodex).
- **D6 Preview flavor renames mechanically**: `Zodex Preview` / `dev.zodex.app.preview` / `zodex-preview` (developer-only test-build variant; same identity file).
- **D7 Updater cache isolation**: electron-builder derives `updaterCacheDirName` from package name `@zcode/desktop` → collides with upstream ZCode's cache on shared machines (ZCodium-documented incident). Fix: final step of the existing `afterPack` hook rewrites `app-update.yml` to `updaterCacheDirName: dev.zodex.app-updater` (PublishManager writes the file before user afterPack runs — verified order).
- **D8 Linux CI targets = AppImage + deb** via env-driven target override (`rpm`/`pacman` remain local-build options). macOS: two arch jobs (`macos-15` arm64, `macos-15-intel` x64), tag + manual dispatch only (10× runner cost), targets dmg+zip, unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`), `notarize:false`. Dual-arch `latest-mac.yml` merged by a release job (`scripts/merge-mac-update-info.mjs` + test) because each arch build writes its own channel file and electron-updater 6.8.3 selects arch from the merged `files[]` URLs (verified in installed source).
- **D9 Upstream attribution**: README links `https://github.com/zai-org/ZCode` (Apache-2.0, verified live, vendor-gate-safe).

## Surface inventory (contract)

URL repoints (with tests): electron-builder homepage/author/maintainer/publish.repo; dev-app-update.yml; remoteCdn base; updateFeedRuntime owner+repo; desktopArchitectureGuard; desktopCommandHandlers releases link; githubIssueUrl; productDocs; plugin-marketplaces libre source+descriptions (libre + official); config/default.json; CLI HTTP-Referer + WebFetch UA (`Zodex-WebFetch/0.1`); specs live-URL sections.

Identity rename: desktop-product-identity.mjs (all flavors); desktopRuntimeEnv runtimeApplicationName; finder workflow bundle id; paths.ts forbidden dirs (ADD Zodex, KEEP ZCode); dev-desktop-remote-prod.mjs; linux deep-link registration (desktop file name, marker, icon name); window titles (web + renderer index.html) + process-names.ts matchers (lockstep); packages/desktop package.json productName/author/description; eb config `.app` name fallbacks; installer.nsh log/display strings; NSIS defaults derive (shortcut/uninstall/install dir) from productName; workflow globs + smoke regex; `Zodex Checkpoint` git author; `Zodex Network CA` subject; `Zodex Computer Use` helper app + coupled CUA strings; X-OpenRouter-Title `Zodex`.

Keep unchanged (internal tokens): `zcode` CLI binary, `zcode://` scheme (last-installed app owns protocol — release-noted), `ZCODE_*` env, `@zcode/*` packages, `zcode-plugins-official/libre` marketplace ids, `zcode-remote-*` asset names, `zcode:` skill prefix, `zcode-dark|light` themes, `X-ZCode-Agent: zcode`, legacy migration dir readers, `ZCodeProject` type, `ZCode.OpenInZCode` registry key name (display text renamed), mcpUserDirectory legacy dirs. Amendment (2026-09-29): dev identity renames to `Zodex Dev` (runtimeApplicationName + dev bundle name; legacy dir readers keep old names by design); display-only mentions of the protocol name render as `Zodex Protocol` in errors/help strings while the `zcode-protocol` module/type identifiers stay.

## Release contract (3.14.3)

- Workflow: windows job (renamed globs) + remote-assets job (unchanged) + NEW linux-desktop job + NEW mac arm64/x64 jobs + NEW mac channel-merge job (tag-gated attach).
- Expected release assets (43, count may drift with remote components): win 3 (exe + latest.yml + exe.blockmap); mac 9 (2 × (dmg + dmg.blockmap + zip + zip.blockmap) + merged latest-mac.yml); linux 3 (AppImage + deb + latest-linux.yml — no AppImage blockmap: this config does not emit one, AppImage updates download the full file); manifests 4; `zcode-remote-*.tar.gz` 24.
- Release notes must state: rename, side-by-side install for old alphas (fresh install recommended), desktop data reset (CLI data survives), unsigned-mac first-run instructions, Linux formats.
- Post-release user verification: in-app/first-run checks on Windows, macOS, Linux.

## Acceptance

All repo gates green (root typecheck/lint/fmt; CLI 4; unit + scripts tests; e2e; vendor-free; architecture full; knip set-diff clean vs branch point; smoke:windows-bundle with `Zodex-*-win-x64.exe`), full workflow proof run on the branch (mac jobs green), release assets verified per contract.
