import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  providerProvisioningEnvelopeSchema,
  type ProviderProvisioningCredentialEntry,
  type ProviderProvisioningEnvelope,
} from "@zcode/shared";
import type {
  PersonalProviderConfigRepository,
  ProviderConfigLayerSnapshot,
} from "@zcode/provider";
import { decodeProviderConfigFile, encodeProviderConfigFile } from "@zcode/provider-node";
import {
  createCredentialCipherProvider,
  type CredentialCipherProvider,
} from "../credential/providers/credentialCipherProvider.js";

const CREDENTIAL_FILE_NAME = "credentials.json";
// P3 C1 供应商 OAuth 删除：原 OAuth 会话凭据键 allowlist（oauth:* / zcodejwttoken /
// oauth:active_provider）已清空。Provisioning 的读取/枚举机制保留，供后续非 OAuth
// 凭据键重新启用；当前同步信封的 credentials 恒为空数组。
export const PROVIDER_PROVISIONING_CREDENTIAL_KEYS: readonly string[] = [];

export interface ProviderProvisioningSource {
  read(syncId: string): Promise<ProviderProvisioningEnvelope>;
}

export interface ProviderProvisioningSourceOptions {
  readonly personalRepository: PersonalProviderConfigRepository;
  readonly credentialFilePath: string;
  readonly personalConfigFilePath: string;
  readonly cipherProvider?: CredentialCipherProvider;
}

/** 从 Local Environment 读取可 Provision 的事实；不会读取或导出完整 Registry Snapshot。 */
export function createProviderProvisioningSource(
  options: ProviderProvisioningSourceOptions,
): ProviderProvisioningSource {
  return {
    async read(syncId: string): Promise<ProviderProvisioningEnvelope> {
      const [personal, credentials] = await Promise.all([
        readProvisionablePersonalConfig(options.personalRepository, options.personalConfigFilePath),
        readProvisioningCredentials(options.credentialFilePath, options.cipherProvider),
      ]);
      // 默认与规则来自同一份持锁读取，不能把两次读取的值拼成不存在的配置版本。
      const personalConfig = encodeProviderConfigFile(personal).config;
      // P1：账号连接设置（providerFamilyDomain / providerFamilyConnectionSelections）已删除，不再进入同步信封。
      return providerProvisioningEnvelopeSchema.parse({
        schemaVersion: 1,
        syncId,
        personalConfig,
        credentials,
      });
    },
  };
}

/** 分发读取不能把坏文件的内存降级当成权威；Source 与 Target 使用同一完整读取约束。 */
export async function readProvisionablePersonalConfig(
  repository: PersonalProviderConfigRepository,
  filePath: string,
): Promise<ProviderConfigLayerSnapshot> {
  const personal = await repository.read();
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isFileNotFound(error)) {
      const rules = personal.models.toPersonalJSON();
      // 首次尚无 Personal 文件是合法空配置；已有内容后文件消失不能继续导出旧快照。
      if (
        personal.providers.keys().length === 0 &&
        rules.providerModelRules.length === 0 &&
        rules.manualProviderModelRules.length === 0 &&
        !personal.providerOrder?.length &&
        personal.defaultModelSelection === undefined
      )
        return personal;
    }
    throw new Error(`本地 Personal Provider Config 无法同步: ${filePath}`, { cause: error });
  }
  try {
    const decoded = decodeProviderConfigFile(JSON.parse(raw) as unknown);
    const actualRevision = createHash("sha256")
      .update(JSON.stringify(encodeProviderConfigFile(decoded)))
      .digest("hex");
    if (actualRevision !== personal.revision) {
      throw new Error("Personal Provider Config 在读取期间发生变化");
    }
    return personal;
  } catch (error) {
    throw new Error(`本地 Personal Provider Config 无法同步: ${filePath}`, { cause: error });
  }
}

async function readProvisioningCredentials(
  credentialFilePath: string,
  cipherProvider?: CredentialCipherProvider,
): Promise<ProviderProvisioningCredentialEntry[]> {
  let raw: string;
  try {
    raw = await readFile(credentialFilePath, "utf8");
  } catch (error) {
    if (isFileNotFound(error)) return [];
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Credential Store 必须是 JSON 对象");
  }
  const cipher = cipherProvider ?? createCredentialCipherProvider();
  const allowedKeys = new Set<string>(PROVIDER_PROVISIONING_CREDENTIAL_KEYS);
  const entries: ProviderProvisioningCredentialEntry[] = [];
  // Credential Store 还可能包含不属于 Provisioning allowlist 的历史记录；
  // 这些记录不是本次同步事实，不能因为其值损坏而阻断合法账号凭据的同步。
  // allowlist 内的条目仍保持字符串和解密校验，避免把未知内容当成 Secret 传输。
  for (const [key, encrypted] of Object.entries(parsed)) {
    // P2：account-provider scope 已删除；历史账号 Key 不再进入同步信封。
    if (!allowedKeys.has(key)) continue;
    if (typeof encrypted !== "string") {
      throw new Error(`Credential allowlist value must be a string: ${key}`);
    }
    const value = cipher.decrypt(encrypted);
    if (!value.trim()) continue;
    entries.push({ scope: "oauth-session", key, value });
  }
  return entries;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export function resolveCredentialFilePath(appConfigDir: string): string {
  return join(appConfigDir, CREDENTIAL_FILE_NAME);
}

/** 只枚举 Provisioning allowlist 的物理 key，供目标端实现 replace-allowlist 删除语义。 */
export async function listProviderProvisioningCredentialKeys(
  credentialFilePath: string,
): Promise<readonly string[]> {
  let raw: string;
  try {
    raw = await readFile(credentialFilePath, "utf8");
  } catch (error) {
    if (isFileNotFound(error)) return [];
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) throw new Error("Credential Store 必须是 JSON 对象");
  const allowedKeys = new Set<string>(PROVIDER_PROVISIONING_CREDENTIAL_KEYS);
  // P2：account-provider 凭据键已删除；P3 C1 起 OAuth allowlist 也已清空，枚举恒为空。
  return Object.keys(parsed).filter((key) => allowedKeys.has(key));
}
