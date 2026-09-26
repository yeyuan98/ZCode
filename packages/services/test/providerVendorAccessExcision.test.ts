import assert from "node:assert/strict";
import test from "node:test";
import { parsePersonalProviderConfigMap } from "@zcode/provider";
// data schema 不是 @zcode/provider 公共出口；单测按源文件相对导入（tsLoader 会回映射 .ts）。
import {
  apiKeyAccessDataSchema,
  providerAccessDataSchema,
} from "../../provider/src/config/provider-data-schema.js";

// P2 vendor 账号访问类型删除后的 schema 边界行为（wave 1 延后的断言）：
// 磁盘/信封里残留的 zhipu-account / zhipu-coding-plan-api-key 必须被整份拒绝，
// 不允许静默降级成普通 api-key。

test("provider access schema rejects zhipu-account access configs", () => {
  const result = providerAccessDataSchema.safeParse({
    type: "zhipu-account",
    accountType: "zai",
    mode: "individual-coding-plan",
    entitled: true,
  });
  assert.equal(result.success, false);
});

test("provider access schema rejects zhipu-coding-plan-api-key access configs", () => {
  const result = apiKeyAccessDataSchema.safeParse({
    type: "zhipu-coding-plan-api-key",
    apiKey: "test-only-key",
  });
  assert.equal(result.success, false);
});

test("stale personal providers file containing vendor access type fails whole-file parse", () => {
  const healthyRule = {
    providerId: "custom-example",
    providerName: "Example provider",
    config: {
      group: "standard-personal",
      access: { type: "api-key", apiKey: "test-only-key" },
      api: {
        type: "openai-chat-completions",
        baseUrl: "https://provider.example/v1",
      },
    },
  };
  const staleVendorRule = {
    providerId: "account:zai-individual-coding-plan",
    providerName: "Z.ai Coding Plan",
    config: {
      access: {
        type: "zhipu-account",
        accountType: "zai",
        mode: "individual-coding-plan",
        entitled: true,
      },
    },
  };
  // 迁移边界（specs/provider-catalog-and-discovery.md）：stale alpha personal.json
  // 整份解析失败并丢掉全部 personal providers；重装/重初始化是文档化救济路径。
  assert.throws(() =>
    parsePersonalProviderConfigMap({
      schemaVersion: 1,
      providerRules: [healthyRule, staleVendorRule],
    }),
  );
});
