# 内置默认配置

`config/default.json` 是随客户端发布的默认配置，必须保留。Desktop 从打包文件读取，
Web 在构建时导入；缺少有效字段时使用内置默认入口兜底。

## 帮助配置来源

P2 起反馈通道改为外部 GitHub Issues，帮助配置（反馈 / 社群入口）只读本地
`config/default.json`，不再请求远端 `/api/v1/client/configs`：

- `feedback_url`：反馈入口地址（GitHub Issues new-issue 页）；入口可用
  `title` / `body` 查询参数预填上下文。缺失时按 `DEFAULT_GITHUB_ISSUES_URL` 兜底。
- `community_urls["zh-CN" | "en-US"]`：按当前语言取对应社群入口，不跨语言回退。

default.json 为随客户端分发的内置默认配置；历史上曾经 CDN 分发、仅为旧版客户端兼容保留，
现版本无请求或 URL 构造链路，只依赖本目录内置文件，其他字段与既有消费者保持不变。
