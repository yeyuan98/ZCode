import { z } from "zod";
import { getCommunityUrlFromConfig, getFeedbackUrlFromConfig } from "./remoteAppConfig.js";

const helpConfigSchema = z.object({
  community_urls: z
    .object({
      "zh-CN": z.string().optional().catch(undefined),
      "en-US": z.string().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  feedback_url: z.string().optional().catch(undefined),
});
export type HelpAppConfig = z.infer<typeof helpConfigSchema>;

// P2：远端 /api/v1/client/configs 帮助配置拉取随供应商反馈通道一起移除，
// 反馈 / 社群入口只读本地 config/default.json（specs/onboarding-and-gate.md 第 5 条）。
// P5 更新域硬切：该接口最后一个读取方（主进程强更 gate）已随 GitHub provider 切换删除，
// /api/v1/client/configs 不再有任何代码路径消费。
export function resolveHelpAppConfig(config: unknown): HelpAppConfig {
  const localConfig = helpConfigSchema.safeParse(config).data;
  return {
    // 社群渠道具有语言边界：只取当前语言的入口，缺失时保持隐藏，
    // 避免中文和英文用户被导向错误渠道。
    community_urls: {
      "zh-CN": getCommunityUrlFromConfig(localConfig, "zh-CN"),
      "en-US": getCommunityUrlFromConfig(localConfig, "en-US"),
    },
    feedback_url: getFeedbackUrlFromConfig(localConfig),
  };
}
