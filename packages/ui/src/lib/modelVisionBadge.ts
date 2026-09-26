/** 产品展示例外：套餐 GLM-5.3 的图片输入是服务端桥接，不能把桥接标为原生视觉。 */
export function shouldShowModelVisionBadge(supportsImage: boolean | null | undefined): boolean {
  // P2：套餐/账号 Access 类型已删除；桥接展示例外随之移除，徽标只反映原生能力事实。
  return supportsImage === true;
}
