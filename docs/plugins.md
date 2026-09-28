# 插件与市场

ZCode 的能力扩展以插件为单位（技能、命令、MCP 工具、子代理）。插件来自三类市场：

## 官方内置市场（zcode-plugins-official）

随应用内置分发，无网络源：

- **browser-use**：内置浏览器自动化（浏览器控制、网页 GUI 测试技能）。
- **node-repl-host**：Node REPL 宿主（不可见、始终可用）。

## 自由市场（zcode-plugins-libre，默认注册）

托管在 [yeyuan98/zcode-plugins](https://github.com/yeyuan98/zcode-plugins)，包含
skill-creator 等 9 个显式来源、可审计的插件。默认注册但**零默认启用**——安装任何
插件都是用户显式动作。插件 zip 为带 sha256 校验的 GitHub Release 资产，目录经
raw.githubusercontent 分发，可经 jsDelivr 类 CDN 访问（见
[updates.md](updates.md)）。

## 个人市场（Personal Sources)

支持 git / GitHub / URL / 本地文件 / 本地目录五种来源，全量功能保留；在插件商店中
添加后与内置市场并列管理。

## 参考

- 商店支持安装 / 卸载 / 启用 / 禁用与手动刷新；默认市场自动刷新（10 分钟节流）。
- 保留市场 id（official / libre）不可被外部来源冒用；个人市场的 manifest 不可声明
  这两个 id。
- 插件开发：插件的 manifest 与打包格式见 CLI 侧契约
  （`apps/zcode-cli/packages/contracts/src/plugins/`）。
