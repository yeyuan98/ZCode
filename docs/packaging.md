# 打包与发布

## 桌面版打包

```bash
pnpm bundle:desktop

# 指定目标平台与 CPU 架构
pnpm bundle:desktop -- --os win --arch x64

pnpm bundle:desktop -- --help
```

默认目标为 macOS arm64，默认输出目录为 `packages/desktop/dist/`。`--os` 支持 `mac`、`win`、`linux`，`--arch` 支持 `x64`、`arm64`；实际打包与签名需要目标平台对应的工具和配置。

安装：双击打开产物 DMG，将 ZCode 拖入"应用程序"。本地构建未签名，首次打开若被 macOS 拦截，执行：

```bash
sudo xattr -rd com.apple.quarantine /Applications/ZCode.app
```

## Windows 本地交叉打包冒烟

改动打包脚本、electron-builder 配置或发布工作流后，可在推送前于本地 Docker（Linux/amd64 宿主）复刻 `.github/workflows/release-desktop.yml` 的 Windows 打包链路：

```bash
pnpm smoke:windows-bundle
# 网络不稳时使用镜像源
pnpm smoke:windows-bundle -- --registry https://registry.npmmirror.com
# 复用已装依赖，仅重跑打包阶段（快速迭代）
pnpm smoke:windows-bundle -- --skip-install
```

脚本在 `~/temp/zcode-smoke/<run-id>/` 暂存当前工作区（含未提交改动）并在容器内执行与工作流一致的 install + bundle 步骤；运行结束默认清理该目录（`--keep` 保留）。pnpm/electron 下载缓存放在 Docker named volume、基础镜像与项目镜像默认保留以加速复跑；`--prune-image` / `--prune-caches` 可显式清理项目镜像与缓存（基础 node 镜像不会删除）。

## ZCode 命令行版打包

构建入口为 `pnpm build:zcode`。脚本会依次构建 CLI/TUI、后端和 Web，收集 TUI 的原生库、worker 与运行时依赖，再组装发行包；运行发行包仍需要 Node.js，版本以 `mise.toml` 为准。

打包前必须设置下载根地址 `ZCODE_DIST_BASE_URL`（可放在 `.env`、`.env.local` 或环境变量中），也可以通过 `--base-url` 传入。以下地址是占位示例，发布时替换为实际托管地址：

```bash
pnpm build:zcode --base-url https://downloads.example.com/zcode/

# 已配置 ZCODE_DIST_BASE_URL 时
pnpm build:zcode

# 仅重新组包，复用已有的 Agent、后端和 Web 构建产物
pnpm build:zcode --skip-build

# 查看版本、输出目录等可选参数
pnpm build:zcode --help
```

默认版本取根目录 `package.json`，输出目录为 `dist/zcode/`：

- `releases/<version>/zcode-<version>.tar.gz`：运行包。
- `releases/<version>/sha256.txt`：校验摘要。
- `latest.json`、`install.sh`：版本索引和安装脚本。

完整目录可上传到配置的下载根地址。安装脚本从该地址下载运行包，默认安装到 `~/.zcode/runtime`，并在 `~/.local/bin` 创建 `zcode` 命令。安装目录可通过 `ZCODE_DIST_HOME` 修改，命令目录可通过 `ZCODE_DIST_BIN_DIR` 修改。

本地调试打包产物时，可直接解压运行，无需上传或安装：

```bash
zcode_version=$(node -p "require('./dist/zcode/latest.json').version")
mkdir -p dist/zcode/debug
tar -xzf "dist/zcode/releases/$zcode_version/zcode-$zcode_version.tar.gz" \
  -C dist/zcode/debug
# 默认启动 TUI
node dist/zcode/debug/zcode/bin/zcode.mjs

# 启动 Web
node dist/zcode/debug/zcode/bin/zcode.mjs --web \
  --workspace "$PWD" --port 3030 --no-open
```

浏览器打开 `http://127.0.0.1:3030`，即可验证同一后端服务托管 Web 页面和 Agent 的完整链路。该端口需要空闲；如正在运行 `pnpm dev:web`，可改用其他 `--port`。

## 发布流程

发版唯一入口是 `pnpm release`（release-it）：自动升版本、按 conventional commit 生成/更新 [CHANGELOG.md](../CHANGELOG.md)、提交 `chore: release vX`、打 `vX` 注解标签并推送。标签推送触发 [Release Desktop](../.github/workflows/release-desktop.yml) 工作流，在 windows-latest 上构建 `ZCode-<version>-win-x64.exe`、更新元数据（`latest.yml` + `.exe.blockmap`），并在 ubuntu-latest 上构建远程资产扁平上传集（各平台 manifest 与组件包），全部挂到 GitHub Release。

- 详细变更写在 commit 消息体的 bullet 列表中，release-it 会把它们渲染为 changelog 条目的子项。
- 禁止手工 `git tag` 发版，会绕过 CHANGELOG 生成。
- 发布前先 `pnpm release --dry-run` 预览；非交互场景使用 `pnpm release --ci`。
- 发布后核对 Actions 运行结果与 Release 资产。
- 推送工作流/打包脚本改动前，先运行 `pnpm smoke:windows-bundle` 做本地验证。

第三方声明生成、发行校验流程及声明在发行物中的位置见 [third-party/README.md](../third-party/README.md)。
