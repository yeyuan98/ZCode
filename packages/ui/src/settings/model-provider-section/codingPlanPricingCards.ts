// 死代码清理：原生购买组件 CodingPlanPricingCards 及其配套 resolver 已随
// CodingPlanPurchasePanel 一起下线（购买流程切换为内嵌官网 webview）。
// P3 C2 供应商套餐/计费面删除：官网购买 webview 与购买入口横幅也已移除，
// resolveCodingPlanUpgradeProductsProviderId 不再有消费方；本文件仅保留设置页
// 状态卡仍在使用的登录参数类型（C4 设置页 de-plan 时整体移除）。

export type CodingPlanLoginOptions = {
  forceOAuth?: boolean;
};
