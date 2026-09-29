// ---- Bot 会话内文件分享（share_file）协议 ----
// 请求只携带 { taskId, path }：收件人由 Host 从自己的 taskDeliveryRegistry 解析，
// 协议参数绝不出现 recipient/provider/peer 字段（bot 会话 force-yolo，模型工具参数
// 不能指派投递目标）。registration 照抄 automation/create 的模式（params/result schema
// 导出 + 方法名表条目）；schema 本体放叶子模块、由 barrel additively 再导出，
// 供 node --test 直跑校验（barrel 会连带加载 strip-only 不支持的 model-option-map）。
import { z } from "zod";
import { botShareFileResultSchema } from "../bots.js";

const nonEmptyString = z.string().trim().min(1);

export const zcodeBotsShareFileParamsSchema = z
  .object({
    taskId: nonEmptyString,
    path: nonEmptyString,
  })
  .strict();
export type ZCodeBotsShareFileProtocolParams = z.infer<typeof zcodeBotsShareFileParamsSchema>;

export const zcodeBotsShareFileResultSchema = botShareFileResultSchema;
export type ZCodeBotsShareFileProtocolResult = z.infer<typeof zcodeBotsShareFileResultSchema>;
