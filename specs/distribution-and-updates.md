# Spec: Distribution & Updates (libre-zcode P5)

Status: design of record for P5. Owners: desktop main (`packages/desktop/src/main/autoUpdater.ts`, `remoteCdn.ts`), server remote install (`packages/server/src/remote/remoteAssetCdn.ts`), plugin marketplace (`packages/shared/src/plugin-marketplaces.ts` + CLI adapters).

Covers: (A) app auto-update, (B) remote-asset downloads, (C) plugin marketplace distribution. Rulings D-P5.1…D-P5.8 recorded here; in-phase amendments append below.

## A. App auto-update → GitHub Releases

**Behavior.**

1. Update feed = this repo's GitHub Releases via electron-updater's `github` provider
   (`publish: {provider:"github", owner:"yeyuan98", repo:"zodex"}` in
   `packages/desktop/electron-builder.config.js`). The Windows release workflow uploads
   `latest.yml` + `Zodex-<version>-win-x64.exe.blockmap` alongside the installer.
2. electron-builder invocation must pass `--publish never` (bundle.mjs): an explicit github
   publish config on a CI tag build would otherwise trigger electron-builder's implicit
   onTag publisher, which throws without GH_TOKEN. softprops remains the sole uploader.
   Smoke (`scripts/smoke-windows-bundle.mjs`) reproduces the CI tag env
   (`CI=true GITHUB_REF_TYPE=tag`) so this path stays covered.
3. Single channel file `latest.yml` (`detectUpdateChannel:false` unchanged). No beta/alpha
   channel files (D-P5.1).
4. `allowPrerelease` floor rule (D-P5.1): `allowPrerelease = receivePreviewUpdates === true ||
currentVersion has prerelease components`. Never below the electron-updater ctor default —
   while no stable release exists, `/releases/latest` 404s and every check would error.
   `autoUpdater.channel` must NEVER be written (leftover channel values stall GitHubProvider's
   atom walk; guarded by test).
5. The three P0-guarded update paths re-enable (flag
   `packages/shared/src/updateFeedPolicy.ts` + its test + all references deleted):
   startup + hourly poll (`enabled: ZCODE_PRODUCT_FLAVOR === "production"` — flavor gating
   predates P0 and stays), manual check, and the force-update startup gate — the gate itself is
   deleted wholesale (vendor `/api/v1/client/configs` kill-switch; `forceUpdateGuard.ts`,
   `forceUpdatePrompt.ts`, `shared/src/forceUpdate.ts`, remoteAppConfig forceUpdate field,
   autoUpdater force machinery, index.ts window plumbing).
6. **Mirror override** (CN reachability): `ZCODE_UPDATE_FEED_URL` env / `--zcode-update-feed-url`
   arg = BASE URL of a generic feed hosting `latest.yml` + installer + `.blockmap` flat at the
   same base. Honored in packaged builds (the P0 `app.isPackaged` ignore is removed). Setting it
   switches the provider from `github` to `{provider:"generic", url, useMultipleRangeRequest:false}`.
   No query parameters are appended. Known caveat: a generic mirror serves whatever its yml
   offers — prerelease filtering does not apply on the mirror path (documented in README).
7. Release-notes persistence, skip-version, download cancellation, quit-and-install teardown
   invariants are provider-agnostic and unchanged. `skippedElectronUpdateVersions` becomes a
   flat per-version list (channel nesting dropped, hard-cut per alpha policy).
8. Cross-channel stale-result discard (`zcodeReleaseChannel` stamping) is deleted — meaningless
   under a single-channel feed.

**Invariants.**

- I1: No code path reaches `checkForUpdates`/`downloadUpdate` before `initAutoUpdater`
  configured the feed (fail-closed latch `autoUpdaterDisabledForProductFlavor` keeps guarding
  the disabled/dev flavors).
- I2: No network call to `zcode.z.ai` from any update path.
- I3: Windows: `autoDownload=false`; `autoInstallOnAppQuit` off on win32;
  `onBeforeQuitAndInstall` awaits host/agent teardown.

## B. Remote assets → GitHub Releases flat naming

**Behavior.**

1. Default base: `https://github.com/yeyuan98/zodex/releases/download/v<ZCODE_VERSION>`.
   Every asset is fetched by exactly ONE URL (candidate probing exists only for non-default
   mirror bases). The `__ZCODE_CDN_BASE_URL__` build-time define is deleted (D-P5.5); runtime
   env `ZCODE_CDN_BASE_URL` still overrides.
2. Flat asset names per release tag (D-P5 confirmed): manifests keep `manifest-<platformArch>.json`;
   component tarballs `zcode-remote-<componentId>-<platformArch>-<version>-<sha12>.tar.gz`
   (`-`-joined; `+` is unsafe in GitHub asset names; sha12 keeps content-addressed republish
   detection). The manifest `artifactPath` uses the same flat names — manifest stays the single
   source of truth; `mount` values (extraction layout) unchanged and still whitelist-validated.
3. Producer `scripts/prepare-prebuilds.mjs` gains a flat-release staging mode that emits the
   upload set (glob in CI — component count varies by platform: 7 linux / 5 darwin). The nested
   dev `mock-cdn` layout is preserved for dev flows and `zcode-server-cli` staging.
4. Mirror override: `ZCODE_REMOTE_ASSET_CDN_BASE_URL` (runtime, desktop → server-injected).
   Pinned (`…/<semver>` last segment) = single candidate + version-match assertion; unpinned =
   nested `[base/<v>, base]` candidates (legacy CDN-style mirrors). GitHub default never probes.
5. New Linux CI job builds + uploads the remote-asset set to the same tag Release. Windows
   installer job keeps `ZCODE_SKIP_REMOTE_ASSETS=1`.
6. `nonReusableReleaseAssetIds` unchanged — reuse matching is by component id + version, never
   by artifact filename.

**Invariants.**

- I4: Every downloaded artifact is sha256-verified against the manifest (all three paths:
  desktop-local, remote-host curl/wget, HEAD progress probe is best-effort).
- I5: No API-based GitHub calls (direct `releases/download` URLs only) — no token story needed;
  rate-limit exposure is bounded by single-candidate fetching.

## C. Plugin marketplace distribution

**Behavior.**

1. Official marketplace `zcode-plugins-official` = **bundled-only**: no `source`, no network
   refresh. Bundled = browser-use + node-repl-host (in-tree packages). The 2026-09-28 CDN probe
   proved all other "official" listings were phantom metadata in this build (sources never
   open-sourced; vendor CDN zips 404).
2. Libre marketplace `zcode-plugins-libre` = first-party network catalog at
   `github.com/yeyuan98/zodex-plugins` (raw.githubusercontent `marketplace.json`; zips as
   flat-named Release assets with sha256). Pre-registered as a second DEFAULT marketplace
   (D-P5.3a): non-removable via UI (same as official), zero default-enabled plugins —
   installation is always an explicit user action.
3. Reserved-id guard: `RESERVED_PLUGIN_MARKETPLACE_IDS` = {official, libre} backs the
   addMarketplace anti-spoof guard + bootstrap same-id protections. `isOfficialMarketplaceId`
   stays official-only (libre is never labeled "official").
4. Initial libre content (D-P5.3b): skill-creator re-sourced from anthropics/skills
   (Apache-2.0, adapted, attribution retained) + 8 re-hosted wrappers (gitlab, cloudbase-skills,
   obsidian, lark-cli, wecom-cli, dingtalk-cli, tencent-meeting-cli, alibaba-cloud-cli) with:
   full license texts where the zips had only a string, copyright lines retained verbatim
   (incl. obsidian's "Copyright (c) 2026 Z.ai" local-additions notice), vendor cosmetics
   stripped from both `.zcode-plugin` + `.claude-plugin` manifests and bilingual READMEs,
   UPSTREAM provenance notes, absolute https icon URLs into the libre repo.
5. Documents quartet gap (D-P5.3c): documents/pdf/presentations/spreadsheets are NOT shipped —
   upstream (anthropics/skills docx/pdf/pptx/xlsx) is proprietary and Z.ai's versions were
   never public; clean-room implementations are a post-P5 track. Release notes + README state
   this.
6. Store auto-refresh covers every DEFAULT marketplace that HAS a source (libre materializes on
   first store open, reusing the existing 10-min throttle); official is skipped (no source).
   Manual refresh unchanged. Featured shelf dies (no `featured` writer anywhere; the vendor CDN
   never set it either).
7. `requiresPaidPlan` deleted end-to-end (manifest schema, parser, badge, i18n, CSS) — vendor
   Coding-Plan upsell residue. The legacy known_marketplaces guard: installs carrying the old
   vendor CDN source for the official id must not network-refresh it (official-id +
   source-less default ⇒ refuse network refresh).
8. `apps/zcode-cli/packages/superpowers-plugin` is RETAINED untouched — it is the MIT
   attribution record for live superpowers-derived builtin skill copy
   (`packages/ui/src/lib/builtinSkillI18n.ts`), not an orphan package.

**Invariants.**

- I6: No request to `cdn-zcode.z.ai` from store code paths (guard test).
- I7: Marketplace entries with installable sources always carry sha256.
- I8: Personal sources (git/github/url/file/directory) fully preserved.

## Endpoint-origin web (adjacent, W5)

Post-P5 no code path targets `{ZCODE}` (share publish, update manifest, client scenes, help
config all dead). Therefore: Help-menu "ZCode Endpoint" selector, `zcodeEndpointOrigin`
AppSettings field + validation + normalization, agent env injection
(`buildAgentEndpointOriginEnv` + desktop runtime env site), `webShareCallbackUrl`, and the
client-scenes chain (`nodeApiClient`, `clientScenesService`, sourceHeaders platform-origin
trust) are deleted (D-P5.4); automation-template/suggested-prompt content that client scenes
fed is replaced with bundled content or removed. The agent runtime has zero live
`ZCODE_BASE_URL` readers (verified 2026-09-28; the four historic sites died in P3/P4).

## Migration boundary

Fresh start / hard-cut per alpha policy: no marketplace migration (old vendor-source records
for the official id stop refreshing, by guard); `skippedElectronUpdateVersions` channel nesting
dropped; `zcodeEndpointOrigin` dropped from settings silently; installed background services
registered under new names (old `com.zhipu.*` services linger until manually removed — no
users, accepted).

## Rulings index

D-P5.1 single-channel + allowPrerelease floor · D-P5.2 share hard-cut (see
`specs/conversation-export.md`) · D-P5.3a pre-registered libre default · D-P5.3b initial set
skill-creator + 8 wrappers · D-P5.3c quartet gap documented · D-P5.4 endpoint-web full cut ·
D-P5.5 drop CDN define · D-P5.6 author email `yeyuan98@users.noreply.github.com` · D-P5.7
export v1 whole-session · D-P5.8 "default marketplace source configurable" = Add-Source
surface + libre default. Amendment of plan-of-record §4 P5.5: vendor-logo registry item was
already satisfied post-P3 (registry holds only local-file zai/bigmodel entries = ordinary
icons).

## Amendments (in-phase)

- **W2 落地补充（布局选择机制）**：flat 与 nested 布局由基址形态决定，不新增
  ConnectOptions 字段——基址末段为 `v<version>`（GitHub tag 目录，含 env
  `ZCODE_CDN_BASE_URL` 根 + 自动追加 `/v<version>` 的形态）即 flat 单候选；裸 semver
  末段 = pinned 单候选 + 版本断言；无版本末段 = nested 双候选。检测实现于
  `remoteAssetCdn.ts::isFlatGithubTagReleaseBase`（W2 [ulw] 评审采纳的显式单候选方案）。
- **W5 落地补充（identity + endpoint web cut）**：
  - Builder identity per D-P5.6：homepage `https://github.com/yeyuan98/zodex`；author
    `{name:"ZCode", email:"yeyuan98@users.noreply.github.com"}`；linux maintainer 同值（deb/fpm
    元数据仍需这些字段，仅换值）。
  - 服务名 D7：`app.zcode.server[.<stablePathId>]`；无迁移（`unregisterService` 对“服务不存在”
    已容忍，旧厂商前缀服务留给用户手动清理；`packages/shared/test/endpointWebPurge.test.ts`
    源码扫描守卫禁止 `com.zhipu` 回流）。
  - 帮助菜单「What's new」（OpenChangelog）：changelog 外链由 `{ZCODE}/cn|/en/changelog`
    改为 `https://github.com/yeyuan98/zodex/releases`（语言分流随 endpoint web 删除）。
  - 架构不匹配弹窗（desktopArchitectureGuard）：下载按钮由厂商 `/cn|/en` 官网页改为同一
    GitHub Releases 页（保留按钮—— Releases 页即安装包分发处，非死链）。
  - clientScenes 内容缺口：automation 模板（「More ideas」+ 闲时模板卡）与新任务页 coding
    chips 推荐按 D8 自然降级移除，**未做打包内置替代**（office 主动推荐仍用
    featureSuggestedPrompts 内置池）。发布说明需记录该缺口。
  - `resolveRuntimeZCodeEnv`（X-Release-Channel，CLI 请求头）自 zcodeEndpoint.ts 迁至
    env.ts 保留；`__ZCODE_ENDPOINT_ENV__` tsup/vite define、`ZCODE_BASE_URL` /
    `ZCODE_ENDPOINT_ORIGIN` 透传（server REMOTE_RUNTIME_ENV_KEYS、desktopRuntimeEnv 注入、
    .env.example 行、e2e fixtures 注入）随 endpoint web 删除。
  - `zcodeEndpoint.ts` / `zcode-source-headers.ts` / services `sourceHeaders.ts` /
    `nodeApiClient`+`apiEndpoints`+`apiJson`+`requestIdHeaders`(+零引用的
    `networkErrorClassifier`) / client-scenes 目录整体删除；`api.ts` 仅保留 `ApiError`
    （claude-native 解析仍用）。`nodeApiNetwork`（undici transport）保留——provider 发现
    仍消费。`stdioDeviceMid` 保留（通用设备身份，P0 裁决非厂商遥测）。

## P6 修订（2026-09-28，用户指令"遗留结构一律删除"）

- **builtinSkillI18n 标记收缩**：`packages/ui/src/lib/builtinSkillI18n.ts` 中仅为已删除
  插件保留的显示名/路径标记（P5 删除的 documents quartet、plugin-creator、
  skill-creator、zcode-guide、image-search、emulators、computer-use、
  restore-legacy-sessions，以 `official-plugin-definitions.ts` 的 P5 删除清单为准）
  整体删除；`superpowers` 标记**保留**（上文 §8：superpowers-plugin 是在用内置技能
  文案的 MIT 归属记录）；`browser` 条目在动手前对照随包技能清单核实去留。记录的
  破坏：早期 alpha 缓存了已删插件技能的安装，其技能描述回退英文原文（该模块只做
  描述本地化，不做名称本地化）。
- **已知市场记录严格化**：撤销 §7 "legacy known_marketplaces guard" 的 inert 语义
  （ensure-skip / update-skip 两层随之下线）。`apps/zcode-cli/packages/adapters/
src/plugins/marketplace.ts` 的 `isKnownMarketplaceRecord` 收紧为当前记录形状（含
  `source` 的具体形状校验），`loadKnownMarketplacesSync` 不再接受 map 容器格式（仅保留
  array）；不匹配的旧格式记录（含 pre-P5 vendor CDN source 形状）**加载即丢弃**。保留
  reserved-id 守卫（`RESERVED_PLUGIN_MARKETPLACE_IDS`）。默认市场经
  `ensureDefaultPluginMarketplaces` 自动重播种。记录的破坏：pre-P5 格式的个人市场
  记录从列表消失、需重新添加。shared schema（`zcodePluginMarketplaceSummarySchema`）
  已是 strict，不动；严格形状/保留 id 契约单测落位 shared
  （packages/shared/test/pluginMarketplacesP6.test.ts；A-P4.1 口径下 CLI 无 runner，
  adapter loader 为薄委托，契约逻辑全部在 shared）。

## P7 修订（2026-09-29）

- **Repo 重命名（specs/rebrand-and-final-release.md D1–D3）**：P7: repo renamed to
  yeyuan98/zodex; product/installer renamed to Zodex; alpha-compat dropped by design。
  本 spec 的 live-contract URL（§A.1 publish repo、§B.1 默认基址、§C.2 libre 仓库、W5
  builder homepage / changelog 外链）与 Windows artifact 文件名前缀
  （`Zodex-<version>-win-x64.exe.blockmap`）随重命名更新；`zcode-remote-*` 资产名与
  `manifest-<platformArch>.json` 命名按 D2 保持不变。
