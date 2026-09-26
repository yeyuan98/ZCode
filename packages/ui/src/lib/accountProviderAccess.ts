import type { ProviderSettingsView } from "@zcode/services";
import type { ZCodeProviderAccountAccess } from "@zcode/shared";

interface EntitledAccountProviderAccess {
  readonly providerId: string;
  readonly access: ZCodeProviderAccountAccess;
  readonly label?: string;
}

// P2：Registry 不再发布 zhipu-account Access；账号访问只能由 P3 重建的连接选择提供。
// 以下解析保留签名供用量/订阅 UI 调用，结果恒为空。

export function resolveEntitledAccountProviderAccess(
  _view: ProviderSettingsView | null | undefined,
  _providerId: string,
): EntitledAccountProviderAccess | null {
  return null;
}

export function resolveEntitledAccountProviderAccessFingerprint(
  view: ProviderSettingsView | null | undefined,
  providerId: string,
): string {
  const access = resolveEntitledAccountProviderAccess(view, providerId);
  return access ? JSON.stringify([view?.revision, access.providerId, access.access]) : "";
}

/**
 * 套餐只读查询不等于执行模型。pending/未选中的账号仍需展示权益，不能要求 current。
 * 本函数只给余额/订阅查询使用，不得用于模型请求或 ModelSelection completion。
 */
export function resolveAccountProviderInspectionAccess(
  _view: ProviderSettingsView | null | undefined,
  _providerId: string,
): EntitledAccountProviderAccess | null {
  return null;
}
