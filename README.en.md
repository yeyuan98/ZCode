# Zodex

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="Zodex" width="128" height="128" />
</div>
<p align="center">
  <a href="README.md">简体中文</a> | English
</p>

Zodex is a community fork of ZCode ([github.com/zai-org/ZCode](https://github.com/zai-org/ZCode), upstream v3.14.3, Apache-2.0) — **tracking-free** (no vendor telemetry, only optional standard OTLP export; app updates come solely from this repo's GitHub Releases; plugin packages from the yeyuan98/zodex-plugins repo Releases) and **vendor-free** (no Z.ai accounts/login/billing/gateway; any API-key provider or local models work, with an automated CI gate blocking vendor code).

Zodex is an AI coding workspace with desktop, browser, and terminal interfaces; local models work via Ollama / vLLM and other OpenAI-compatible endpoints.

## Quick Start

**Install**: download from [GitHub Releases](https://github.com/yeyuan98/zodex/releases), or build from source (see [docs/packaging.md](docs/packaging.md)):

- Windows: `Zodex-<version>-win-x64.exe`
- macOS: `Zodex-<version>-mac-<arch>.dmg` / `.zip` (unsigned — on first run right-click → Open, or run `sudo xattr -rd com.apple.quarantine /Applications/Zodex.app`)
- Linux: `Zodex-<version>-linux-x86_64.AppImage` and `Zodex-<version>-linux-amd64.deb`

In-app auto-update is available on all three platforms; update metadata comes from the same Releases.

**First run**:

1. Launch the app; the onboarding wizard opens.
2. Configure one model provider: pick a built-in template (DeepSeek, OpenAI, z.ai, BigModel, …) and paste an API key, or use local models via the Ollama template / any OpenAI-compatible endpoint. See [docs/providers.md](docs/providers.md).
3. Start a session. Plugins, skills, and marketplaces: [docs/plugins.md](docs/plugins.md).

**Terminal**: `zcode` starts the TUI, `zcode --web` serves the browser UI — build and install steps in [docs/packaging.md](docs/packaging.md).

## Documentation

| Doc                                        | Contents                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| [docs/providers.md](docs/providers.md)     | Providers & models: API keys, Ollama, vLLM, configuration reference       |
| [docs/updates.md](docs/updates.md)         | App updates, per-OS update channels, mirror overrides for restricted nets |
| [docs/plugins.md](docs/plugins.md)         | Plugins, bundled & libre marketplaces, personal sources                   |
| [docs/development.md](docs/development.md) | Dev environment, per-target workflows, tests & gates, repo layout         |
| [docs/packaging.md](docs/packaging.md)     | Desktop/CLI packaging, Windows bundle smoke test, release process         |

## Project Notice

Scope of features, maintenance rules, execution and data risks, licensing, and third-party copyright notices: see [NOTICE.md](NOTICE.md).
