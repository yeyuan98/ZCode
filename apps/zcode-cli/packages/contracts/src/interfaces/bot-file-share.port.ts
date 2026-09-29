// ============================================================
// Bot File Share Port - conversational bot file delivery boundary
// ============================================================
// bot 会话（微信私聊）里 share_file 工具经此把文件投递交给 Host RPC
// （bots/shareFile）。收件人由 Host 侧解析，端口入参只有工作区相对路径。

import type { BotShareFileResult } from "@zcode/shared";

export interface BotFileSharePort {
  share(path: string): Promise<BotShareFileResult>;
}
