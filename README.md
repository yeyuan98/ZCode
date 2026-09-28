# Zodex

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="Zodex" width="128" height="128" />
</div>
<p align="center">
  简体中文 | <a href="README.en.md">English</a>
</p>

Zodex 是 ZCode（[github.com/zai-org/ZCode](https://github.com/zai-org/ZCode)，上游 v3.14.3，Apache-2.0）的社区分支：**不跟踪**（无厂商遥测，仅可选的标准 OTLP 导出；应用更新只来自本仓库 GitHub Releases，插件包来自 yeyuan98/zodex-plugins 仓库 Releases）、**无厂商绑定**（无 Z.ai 账号/登录/计费/网关，任意 API Key 或本地模型即可用，CI 门禁自动拦截厂商代码回流）。

Zodex 是 AI 编程工作台，提供桌面应用、浏览器界面和终端 Agent，本地模型支持 Ollama / vLLM 等 OpenAI 兼容端点。

## 快速开始

**安装**：从 [GitHub Releases](https://github.com/yeyuan98/zodex/releases) 下载，或从源码构建（见 [docs/packaging.md](docs/packaging.md)）：

- Windows：`Zodex-<version>-win-x64.exe`
- macOS：`Zodex-<version>-mac-<arch>.dmg` / `.zip`（未签名，首次打开需右键 → 打开，或执行 `sudo xattr -rd com.apple.quarantine /Applications/Zodex.app`）
- Linux：`Zodex-<version>-linux-x86_64.AppImage` 与 `Zodex-<version>-linux-amd64.deb`

三平台均支持应用内自动更新，更新元数据来自同一 Releases。

**首次运行**：

1. 启动应用，进入引导向导。
2. 配置一个模型供应商：内置模板（DeepSeek、OpenAI、z.ai、BigModel 等）填 API Key；本地模型选 Ollama 模板或自定义 OpenAI 兼容端点。详见 [docs/providers.md](docs/providers.md)。
3. 开始会话。插件、技能与市场见 [docs/plugins.md](docs/plugins.md)。

**命令行版**：`zcode` 进入 TUI，`zcode --web` 启动浏览器界面，构建与安装见 [docs/packaging.md](docs/packaging.md)。

## 文档

| 文档                                       | 内容                                              |
| ------------------------------------------ | ------------------------------------------------- |
| [docs/providers.md](docs/providers.md)     | 供应商与模型配置：API Key、Ollama、vLLM、配置参考 |
| [docs/updates.md](docs/updates.md)         | 应用更新、各平台更新通道、网络受限环境的镜像覆盖  |
| [docs/plugins.md](docs/plugins.md)         | 插件、官方内置与自由市场、个人市场来源            |
| [docs/development.md](docs/development.md) | 开发环境、各端开发工作流、测试与门禁、仓库结构    |
| [docs/packaging.md](docs/packaging.md)     | 桌面/命令行打包、Windows 打包冒烟、发布流程       |

## 项目声明

功能与优惠范围、维护规则、执行与数据风险，以及许可和第三方版权说明，详见 [NOTICE.md](NOTICE.md)。
