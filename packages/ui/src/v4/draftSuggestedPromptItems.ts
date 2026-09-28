// P5 D-P5.4：本文件原先承载 Client Scenes（/api/v1/client/scenes）到推荐提示词的映射；
// 该链路已随 endpoint web 删除，仅保留被打包内置推荐（featureSuggestedPrompts）继续
// 消费的数据结构与文案解析函数。不再引入 @zcode/services 的 ClientScene* 类型。
export interface DraftSuggestedPromptLocalizedText {
  cn?: string;
  en?: string;
}

export interface DraftSuggestedPromptItem {
  id: string;
  /** Lucide canonical 名称（历史来源 ClientSceneItem.img）；打包内置条目不携带。 */
  iconName?: string;
  /** 打包内置推荐项的市场图标。 */
  iconUrl?: string;
  label: DraftSuggestedPromptLocalizedText;
  prompt: DraftSuggestedPromptLocalizedText;
  plugin?: {
    stableId: string;
    label: DraftSuggestedPromptLocalizedText;
  };
}

export function resolveDraftSuggestedPromptText(
  text: DraftSuggestedPromptLocalizedText,
  locale: string,
): string {
  const primary = locale.startsWith("zh") ? text.cn : text.en;
  const fallback = locale.startsWith("zh") ? text.en : text.cn;
  return primary?.trim() || fallback?.trim() || "";
}
