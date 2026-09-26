import { resolveHelpAppConfig, type Locale } from "@zcode/shared";
import localDefaultAppConfig from "../../../config/default.json" with { type: "json" };

interface ResolveWebCommunityUrlOptions {
  localConfig?: unknown;
}

// P2：远端 /api/v1/client/configs 帮助配置拉取随供应商反馈通道移除，
// Web 的反馈 / 社群入口只读构建时打包的本地 config/default.json。
export function resolveWebHelpConfig(options: ResolveWebCommunityUrlOptions = {}) {
  return resolveHelpAppConfig(options.localConfig ?? localDefaultAppConfig);
}

export async function resolveWebCommunityUrl(
  locale: Locale,
  options: ResolveWebCommunityUrlOptions = {},
): Promise<string | undefined> {
  return (await resolveWebHelpConfig(options)).community_urls?.[locale];
}
