// Bots 模块 Node 装配契约（architecture-policy publicEntrypoints 之一）。
// 边界约定：
// - 只在 Node 宿主使用：window Host / stdio 入口的服务装配，经 @zcode/services
//   的 node 入口再导出；renderer 浏览器包一律走浏览器安全子契约 contract.ts。
// - 在 contract.ts 的基础上追加 create* 装配工厂（它们静态引入 node:fs 等
//   内置模块、@zcode/provider 与 provider 适配器，绝不可进入浏览器 import 图）。
// - 本文件只做再导出，不引入新行为。
export * from "./contract.js";
export { createBotsService } from "./botsService.js";
export { createBotRemoteWorkspaceService } from "./botRemoteWorkspaceBridge.js";
export { createBotWorkspaceFileService } from "./botWorkspaceFileService.js";
export {
  createBotsShareFileExecutor,
  createBotShareFileForwarder,
  createDesktopBotShareFileForwardService,
} from "./botShareFileForwardService.js";
