/**
 * useCredentials —— 凭据服务 hooks
 *
 * P3 C1 供应商 OAuth 删除：OAuth access_token 专用 hook（useAuthToken）已随
 * 登录会话机制移除；通用凭据读写（bots/webhooks 等）保持不变。
 */
import { useCallback } from "react";
import { useServices } from "./useServices.js";

/** 凭据管理的基础 hook */
export function useCredentials() {
  const { credentialService } = useServices();

  const load = useCallback((key: string) => credentialService.load(key), [credentialService]);
  const save = useCallback(
    (key: string, value: string) => credentialService.save(key, value),
    [credentialService],
  );
  const del = useCallback((key: string) => credentialService.delete(key), [credentialService]);

  return { load, save, delete: del };
}
