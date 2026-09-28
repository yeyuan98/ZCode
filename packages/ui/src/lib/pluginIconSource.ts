import { isTrustedImageUrl } from "@/lib/trustedImageUrl.js";

// P5（去供应商化）：官方目录收敛为 browser-use + node-repl-host，两者都不再携带客户端
// 打包图标——原 documents/pdf/presentations/spreadsheets/plugin-creator 映射指向的图标
// 属于已删除的幻影官方插件，随之一并清理（vendor CDN 图标也从官方 definition 移除）。
// libre 市场与个人源的条目图标统一走 https 信任判定，失败降级字母头像。
// 保留空映射与既有函数签名，避免 4 个调用方（PluginIcon、prompt mention 装饰、
// 会话输入投影等）连锁改动；后续如需再内置图标，在此补条目即可。
const OFFICIAL_PLUGIN_ICON_BY_ID: Readonly<Record<string, string>> = {};

const TRUSTED_BUNDLED_PLUGIN_ICONS = new Set(Object.values(OFFICIAL_PLUGIN_ICON_BY_ID));

/** 按完整身份解析客户端自有图标，避免商店、候选和消息各自维护不同例外。 */
export function resolvePluginIconSource(
  pluginId: string | undefined,
  icon?: string,
): string | undefined {
  if (pluginId) {
    const bundledIcon = OFFICIAL_PLUGIN_ICON_BY_ID[pluginId];
    if (bundledIcon) return bundledIcon;
  }
  return isTrustedImageUrl(icon) ? icon : undefined;
}

/** Session 投影已完成身份匹配；仅放行固定打包资源，不放宽任意本地 URL。 */
export function isTrustedPluginIconSource(icon: string | undefined): icon is string {
  return Boolean(icon && TRUSTED_BUNDLED_PLUGIN_ICONS.has(icon)) || isTrustedImageUrl(icon);
}
