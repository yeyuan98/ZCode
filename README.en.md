# ZCode

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="ZCode" width="128" height="128" />
</div>
<p align="center">
  <a href="README.md">简体中文</a> | English
</p>

ZCode is an AI coding workspace with desktop, browser, and terminal interfaces. It works with any API-key provider or local models (Ollama / vLLM) — no cloud account required.

## Quick Start

**Install**: grab the latest installer from [GitHub Releases](https://github.com/yeyuan98/ZCode/releases), or build from source (see [docs/packaging.md](docs/packaging.md)).

**First run**:

1. Launch the app; the onboarding wizard opens.
2. Configure one model provider: pick a built-in template (DeepSeek, OpenAI, z.ai, BigModel, …) and paste an API key, or use local models via the Ollama template / any OpenAI-compatible endpoint. See [docs/providers.md](docs/providers.md).
3. Start a session. Plugins, skills, and marketplaces: [docs/plugins.md](docs/plugins.md).

**Terminal**: `zcode` starts the TUI, `zcode --web` serves the browser UI — build and install steps in [docs/packaging.md](docs/packaging.md).

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/providers.md](docs/providers.md) | Providers & models: API keys, Ollama, vLLM, configuration reference |
| [docs/updates.md](docs/updates.md) | App updates, prerelease channel, mirror overrides for restricted networks |
| [docs/plugins.md](docs/plugins.md) | Plugins, bundled & libre marketplaces, personal sources |
| [docs/development.md](docs/development.md) | Dev environment, per-target workflows, tests & gates, repo layout |
| [docs/packaging.md](docs/packaging.md) | Desktop/CLI packaging, Windows bundle smoke test, release process |

## Project Notice

Scope of features, maintenance rules, execution and data risks, licensing, and third-party copyright notices: see [NOTICE.md](NOTICE.md).
