# @zcode/server

自托管 HTTP/WebSocket 服务：托管 Web 构建产物，并暴露 `/ws` RPC 与 `/api` 接口。

## 认证

- `ZCODE_SERVER_AUTH_TOKEN`：设置后启用访问认证，`/ws`、`/ws/*` 与 `/api/*` 需要令牌。请求可携带 `?token=`（校验通过后服务端下发 `zcode_lite_token` HttpOnly Cookie），或直接携带该 Cookie。
- `ZCODE_SERVER_TOKEN` 不参与认证校验，仅在程序选项未指定 `authRequired` 时影响 `/api/server-info` 广播的 `authRequired` 字段。
- 其他常用变量：`PORT`（默认 3030）、`ZCODE_SERVER_HOST` / `HOST`、`ZCODE_WEB_STATIC_ROOT`（静态根目录，启用 SPA fallback）。

## Web 登录页

启用 `ZCODE_SERVER_AUTH_TOKEN` 后，Web 客户端启动时探测 `/api/server-info`：返回 401 时先展示令牌登录页，输入正确令牌（服务端下发 Cookie）后进入应用；未启用认证的服务器不会出现登录页。
