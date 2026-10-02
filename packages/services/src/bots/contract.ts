// Bots 模块公共契约（front door，architecture-policy publicEntrypoints）。
// 边界约定：
// - 包外消费者只经 @zcode/services 根入口（index.ts / node.ts）取用本模块能力；
//   根入口与包内装配（node.ts / accessor.ts）一律从本文件再导出，保持单一入口路径。
// - 浏览器安全部分：service descriptor 与纯类型——renderer 经根 index 拉进浏览器包时
//   不连带 Node 依赖（与根 index 既有约定一致）。
// - Node 装配部分：create* 工厂只在 Node 宿主执行（window Host / stdio 入口装配），
//   经 node 入口导出。
// - 本文件只做再导出，不引入新行为；行为规格见 specs/bot-file-delivery.md 与
//   specs/bot-provider-network.md，模块边界说明见同目录 CONTRACT.md。
export { IBotsService } from "./bots.js";
export type {
  BotBindCodeResult,
  BotCreateBindCodeParams,
  BotListWorkspaceRefsParams,
  BotSaveBotParams,
  BotSaveBotResult,
  BotTestResult,
} from "./bots.js";
// Bot 出站投递的远端 workspace 文件读取窄化 channel（Phase C Alpha 2）。
export {
  IBotWorkspaceFileService,
  createBotWorkspaceFileService,
} from "./botWorkspaceFileService.js";
export type { BotWorkspaceFileV4Forwarder } from "./botWorkspaceFileService.js";
// 对话式 share_file 的远端→桌面反向转发窄化 channel（Phase C Alpha 3）。
export { IBotShareFileForwardService } from "./botShareFileForwardService.js";
export type { BotShareFileForwarder } from "./botShareFileForwardService.js";
export {
  createBotsShareFileExecutor,
  createBotShareFileForwarder,
  createDesktopBotShareFileForwardService,
} from "./botShareFileForwardService.js";
export { createBotsService } from "./botsService.js";
export { createBotRemoteWorkspaceService } from "./botRemoteWorkspaceBridge.js";
