import { z } from "zod";

/** 文本与附件发送共用执行约束，凭据只属于单次执行，不进入 Session 配置。
 *  P3：requestAuth（闲时票据鉴权注入）字段已删除——执行凭据完全由目标 Provider 常规配置解析。 */
export const modelExecutionSchema = z
  .object({
    memoryExtraction: z.literal("skip").optional(),
    selectionScope: z.literal("execution"),
    subagents: z
      .object({
        foregroundModel: z.literal("submission"),
        background: z.literal("deny"),
      })
      .strict()
      .optional(),
  })
  .strict();
