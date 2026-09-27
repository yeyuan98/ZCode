import { useCallback } from "react";
import type { PluginStoreOrder } from "@zcode/shared";

// P3 C5 供应商 client/configs 拉取删除：插件商店排序不再由远端
// /api/v1/client/configs（pluginStoreOrder）下发，固定回退打包默认顺序——
// shared/pluginStoreOrdering 的产品默认分类顺序 + 文档插件置顶 + 本地化名称稳定排序。
// order 恒为 null，消费方（PluginStorePage / WorkspacePluginPreview / mentions provider）
// 走默认排序；保留 hook 形状（含 refresh）避免连锁改动。
export function usePluginStoreOrder(_enabled = true) {
  // 远端来源已删除；refresh 保留签名但为 no-op（本地默认顺序无需刷新）。
  const refresh = useCallback(async (_forceRefresh?: boolean) => {}, []);
  return { order: null as PluginStoreOrder | null, refresh };
}
