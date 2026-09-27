import { z } from "zod";

// P3 C5 供应商 client/configs 拉取删除：远端 pluginStoreOrder 下发与响应解析
// （parsePluginStoreOrder / envelope schema）已移除；这里只保留排序数据形状，
// 供打包默认排序（pluginStoreOrdering）与 UI 类型使用。
const orderList = z.array(z.string().trim().min(1));
const modeOrderSchema = z.object({
  categoryOrder: orderList.optional(),
  pluginOrder: z.record(z.string(), orderList).optional(),
});
const pluginStoreOrderSchema = z.object({
  code: modeOrderSchema.optional(),
  work: modeOrderSchema.optional(),
});

export type PluginStoreModeOrder = z.infer<typeof modeOrderSchema>;
export type PluginStoreOrder = z.infer<typeof pluginStoreOrderSchema>;
