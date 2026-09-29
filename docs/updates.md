# 更新与镜像

## 应用更新机制

- 桌面版内置更新器（electron-updater，GitHub Releases 托管）：安装包、各平台更新通道文件与
  `.blockmap` 均挂在 [本仓库 Releases](https://github.com/yeyuan98/zodex/releases)。
- 更新通道由设置「接受提前收到预览版更新（Alpha）」控制：开启后可收到 alpha 预发布；
  关闭后只检查正式版。**关闭不会降级**——运行 alpha 版本的客户端关闭开关后将保持当前
  版本，直到下一个正式版版本号超过它。使用 `ZCODE_UPDATE_FEED_URL` 镜像时不受通道
  过滤：镜像上的通道文件提供什么版本，客户端就会提示什么版本。
- 手动检查更新：帮助菜单 → 检查更新。

## 各平台更新通道

- Windows 读取 `latest.yml`，macOS 读取 `latest-mac.yml`，Linux 读取 `latest-linux.yml`，
  均来自本仓库 Releases。
- `latest-mac.yml` 是 arm64 与 x64 双架构合并后的单份文件。
- 使用 `ZCODE_UPDATE_FEED_URL` 镜像的用户，需在镜像基址下同步托管本平台的通道文件及
  对应产物（安装包与 `.blockmap`）。

## 网络受限环境（镜像覆盖）

更新、远程资产与插件市场默认托管在本仓库 GitHub Releases 与 `yeyuan98/zodex-plugins`。
GitHub 访问受限时可用以下环境变量覆盖：

| 变量                              | 用途                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ZCODE_UPDATE_FEED_URL`           | 应用更新镜像基址（也可用启动参数 `--zcode-update-feed-url`）。镜像需在**同一基址下平铺**存放本平台通道文件（`latest.yml` / `latest-mac.yml` / `latest-linux.yml`）、安装包与 `.blockmap`。注意：generic 镜像不区分预发布版本——镜像上的通道文件提供什么版本，客户端就会提示什么版本。 |
| `ZCODE_CDN_BASE_URL`              | 远程资产镜像**根**基址（扁平布局）：客户端会自动追加 `/v<当前版本>` 目录。                                                                                                                                                                                                           |
| `ZCODE_REMOTE_ASSET_CDN_BASE_URL` | 远程资产镜像完整基址（嵌套布局：不带版本的根目录或固定版本的目录均可）。远程主机（SSH 目标机）直接经 curl/wget 下载，桌面代理不作用于该链路。                                                                                                                                        |

插件市场目录可经 jsDelivr 类 CDN 访问
（`https://cdn.jsdelivr.net/gh/yeyuan98/zodex-plugins@main/marketplace.json`），
插件 zip 始终来自 GitHub Releases，详见 [plugins.md](plugins.md)。

## 参考

- 版本规则、alpha 发布流程与上游 ZCode 合并 runbook：[versioning.md](versioning.md)、
  [upstream-sync.md](upstream-sync.md)。
- 远程资产（SSH/WSL 远程工作区的运行时组件）清单与校验：仓库 Release 的
  `manifest-<platform>.json` 与 `zcode-remote-*.tar.gz` 组件包。
- 更新相关设计记录：[specs/distribution-and-updates.md](../specs/distribution-and-updates.md)。
