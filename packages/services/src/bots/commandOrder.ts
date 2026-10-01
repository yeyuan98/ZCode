import type { BotCommandPolicy } from "@zcode/shared";
const BOT_POLICY_COMMAND_ORDER = [
  "status",
  "new",
  "workspace",
  "model",
  "mode",
  "thoughtLevel",
  "reply",
] as const satisfies readonly (keyof BotCommandPolicy)[];

// /file 是动作命令而非设置命令：不进 BOT_POLICY_COMMAND_ORDER（那是 keyof BotCommandPolicy
// 的设置命令清单），只按菜单顺序排在策略命令之后、bind 之前（specs/bot-file-delivery.md Alpha 5）。
export const BOT_MENU_COMMAND_ORDER = [
  "help",
  ...BOT_POLICY_COMMAND_ORDER,
  "file",
  "bind",
] as const;
