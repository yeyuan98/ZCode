# 更新与镜像

## 应用更新机制

- 桌面版内置更新器（electron-updater，GitHub Releases 托管）：安装包、`latest.yml`
  与 `.exe.blockmap` 均挂在 [本仓库 Releases](https://github.com/yeyuan98/ZCode/releases)。
- 正式版发布前，所有版本都是**预发布**（prerelease）。运行预发布版本的客户端默认接收
  预发布更新；稳定版客户端默认只接收稳定版，可在设置中开启预览通道。
- 手动检查更新：帮助菜单 → 检查更新。

## 网络受限环境（镜像覆盖）

更新、远程资产与插件市场默认托管在本仓库 GitHub Releases 与 `yeyuan98/zcode-plugins`。
GitHub 访问受限时可用以下环境变量覆盖：

| 变量 | 用途 |
| --- | --- |
| `ZCODE_UPDATE_FEED_URL` | 应用更新镜像基址（也可用启动参数 `--zcode-update-feed-url`）。镜像需在**同一基址下平铺**存放 `latest.yml`、安装包与 `.exe.blockmap`。注意：generic 镜像不区分预发布版本——镜像上的 `latest.yml` 提供什么版本，客户端就会提示什么版本。 |
| `ZCODE_CDN_BASE_URL` | 远程资产镜像**根**基址（扁平布局）：客户端会自动追加 `/v<当前版本>` 目录。 |
| `ZCODE_REMOTE_ASSET_CDN_BASE_URL` | 远程资产镜像完整基址（嵌套布局：不带版本的根目录或固定版本的目录均可）。远程主机（SSH 目标机）直接经 curl/wget 下载，桌面代理不作用于该链路。 |

插件市场目录可经 jsDelivr 类 CDN 访问
（`https://cdn.jsdelivr.net/gh/yeyuan98/zcode-plugins@main/marketplace.json`），
插件 zip 始终来自 GitHub Releases，详见 [plugins.md](plugins.md)。

## 参考

- 远程资产（SSH/WSL 远程工作区的运行时组件）清单与校验：仓库 Release 的
  `manifest-<platform>.json` 与 `zcode-remote-*.tar.gz` 组件包。
- 更新相关设计记录：[specs/distribution-and-updates.md](../specs/distribution-and-updates.md)。
