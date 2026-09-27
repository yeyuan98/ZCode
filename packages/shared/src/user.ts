/**
 * 休眠用户框架（P3 ruling 6，specs/account-services-purge.md）。
 *
 * 供应商 OAuth 登录机制已在 P3 C1 删除；`UserInfo` 作为中立身份类型从
 * shared/src/oauth.ts 迁出保留，供 store（user/setUser/authSessionSeq）与
 * 既有 UI 线程继续使用。后续恢复真实身份提供方时只需替换启动 initializer，
 * 类型与 store 管道保持不变。
 */
export interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}
