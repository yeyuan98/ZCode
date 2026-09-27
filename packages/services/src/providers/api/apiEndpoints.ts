import { buildRuntimeZCodeApiUrl } from "@zcode/shared";

export const ZCODE_CLIENT_SCENES_URL = buildRuntimeZCodeApiUrl(
  process.env,
  "/api/v1/client/scenes",
);

// P3 C2 供应商套餐/计费面删除：ZAI_API_HOST（resolveZaiBusinessBaseUrl 解析，仅
// accountProvider API key 解析链消费）已随账号 provider 链路移除。
