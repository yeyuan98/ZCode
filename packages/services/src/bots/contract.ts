// Bots 模块公共契约（front door，architecture-policy publicEntrypoints）。
// 边界约定：
// - 包外消费者只经 @zcode/services 根入口（index.ts / node.ts）取用本模块能力；
//   根入口与包内装配（node.ts / accessor.ts）一律从本文件（或 Node 装配入口
//   contract.node.ts）再导出，生产代码保持单一入口路径（测试按 session 先例
//   允许直接引用内部文件）。
// - 本文件是浏览器安全子契约：只含 service descriptor 与纯类型。renderer 经根
//   index 拉进浏览器包时不得连带 Node 依赖——因此本文件禁止再导出任何 create*
//   装配工厂（它们静态引入 node:fs 等内置模块与 provider 适配器）。
// - Node 装配工厂统一走同目录 contract.node.ts。
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
export { IBotWorkspaceFileService } from "./botWorkspaceFileService.js";
export type { BotWorkspaceFileV4Forwarder } from "./botWorkspaceFileService.js";
// 对话式 share_file 的远端→桌面反向转发窄化 channel（Phase C Alpha 3）。
export { IBotShareFileForwardService } from "./botShareFileForwardService.js";
export type { BotShareFileForwarder } from "./botShareFileForwardService.js";
