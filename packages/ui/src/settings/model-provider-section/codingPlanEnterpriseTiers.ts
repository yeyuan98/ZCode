// 2026-09: 原生购买面板（CodingPlanPurchasePanel）整体下线，购买流程切换为内嵌官网
// webview。本文件迁出该面板中仍被设置页（Detail.tsx）使用的购买对象类型。
// P3 C2 供应商套餐/计费面删除：官网购买 webview 已移除；EnterpriseCodingPlanProductGroup
// （企业定价目录分组）随数据源删除，仅保留 StatusCards/Detail 的展示签名仍引用的
// PurchaseAudience，C4 设置页 de-plan 时一并移除。

export type PurchaseAudience = "personal" | "team";
