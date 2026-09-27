/**
 * 通用凭据存储（credentialService）的解密失败错误约定。
 *
 * P3 C1 删除 shared/src/oauth.ts 后，供应商 OAuth 仓储（oauthCredentialRepo）
 * 已不存在；此处仅保留通用凭据层仍在消费的稳定错误码与消息前缀，
 * 与登录态无关的凭据（bots/webhooks 等）解密失败仍按此口径识别。
 */

/** 凭据解密失败错误前缀 */
export const CREDENTIAL_DECRYPT_ERROR_PREFIX = "凭据解密失败：" as const;

/** 凭据解密失败稳定错误码 */
export const CREDENTIAL_DECRYPT_ERROR_CODE = "ZCODE_CREDENTIAL_DECRYPT_FAILED" as const;
