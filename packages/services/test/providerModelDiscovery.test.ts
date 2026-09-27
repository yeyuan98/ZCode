import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ProviderConfigMap,
  ProviderConfigResolver,
  type ProviderConfigObject,
  type ProviderSettingsTemplateView,
} from "@zcode/provider";
import {
  discoverModelsForEndpoint,
  discoverTemplateModels,
  type DiscoverTemplateModelsFetch,
} from "../src/model-provider/providerModelDiscovery.js";
import { createProviderConfigRuntime } from "../src/model-provider/providerConfigRuntime.js";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";

function templateView(config: ProviderConfigObject): ProviderSettingsTemplateView {
  return Object.freeze({ templateId: "test-template", templateNameMap: {}, config });
}

interface RecordedRequest {
  readonly url: URL;
  readonly headers: Record<string, string>;
}

function createRecordingFetch(
  handle: (request: RecordedRequest) => { readonly status?: number; readonly body: string },
): { fetch: DiscoverTemplateModelsFetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? String(input) : input.url,
    );
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const request: RecordedRequest = { url, headers };
    requests.push(request);
    const response = handle(request);
    return new Response(response.body, {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as DiscoverTemplateModelsFetch;
  return { fetch: fetchStub, requests };
}

test("openai-compatible discovery hits the versioned models endpoint with bearer auth", async () => {
  const { fetch, requests } = createRecordingFetch(() => ({
    body: JSON.stringify({
      data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-a" }, { id: "" }],
    }),
  }));
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: " test-key " },
    {
      fetch,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "openai-chat-completions", baseUrl: "https://provider.example/v1" },
      }),
    },
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.toString(), "https://provider.example/v1/models");
  assert.equal(requests[0].headers.authorization, "Bearer test-key");
  assert.deepEqual(result, { ok: true, modelIds: ["model-a", "model-b"] });
});

test("openai-compatible discovery normalizes an unversioned base url", async () => {
  const { fetch, requests } = createRecordingFetch(() => ({
    body: JSON.stringify({ data: [{ id: "model-a" }] }),
  }));
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: "test-key" },
    {
      fetch,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "openai-chat-completions", baseUrl: "https://provider.example" },
      }),
    },
  );
  assert.equal(requests[0].url.toString(), "https://provider.example/v1/models");
  assert.deepEqual(result, { ok: true, modelIds: ["model-a"] });
});

test("keyless template discovery omits auth headers for local endpoints", async () => {
  const { fetch, requests } = createRecordingFetch(() => ({
    body: JSON.stringify({ data: [{ id: "llama-local" }] }),
  }));
  const result = await discoverTemplateModels(
    { templateId: "test-template" },
    {
      fetch,
      template: templateView({
        api: { type: "openai-chat-completions", baseUrl: "http://localhost:11434/v1" },
      }),
    },
  );
  assert.equal(requests[0].url.toString(), "http://localhost:11434/v1/models");
  assert.equal(requests[0].headers.authorization, undefined);
  assert.deepEqual(result, { ok: true, modelIds: ["llama-local"] });
});

test("anthropic discovery pages through the after_id cursor", async () => {
  const { fetch, requests } = createRecordingFetch(({ url }) =>
    url.searchParams.has("after_id")
      ? { body: JSON.stringify({ data: [{ id: "claude-b" }] }) }
      : {
          body: JSON.stringify({
            data: [{ id: "claude-a" }],
            has_more: true,
            last_id: "claude-a",
          }),
        },
  );
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: "test-key" },
    {
      fetch,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "anthropic-messages", baseUrl: "https://api.anthropic.com" },
      }),
    },
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.toString(), "https://api.anthropic.com/v1/models");
  assert.equal(requests[0].headers["x-api-key"], "test-key");
  assert.equal(requests[0].headers["anthropic-version"], "2023-06-01");
  assert.equal(requests[1].url.searchParams.get("after_id"), "claude-a");
  assert.deepEqual(result, { ok: true, modelIds: ["claude-a", "claude-b"] });
});

test("anthropic discovery caps paging at ten requests", async () => {
  const { fetch, requests } = createRecordingFetch(({ url }) => {
    const page = url.searchParams.get("after_id") ?? "0";
    return {
      body: JSON.stringify({
        data: [{ id: `claude-${page}` }],
        has_more: true,
        last_id: `${Number(page) + 1}`,
      }),
    };
  });
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: "test-key" },
    {
      fetch,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "anthropic-messages", baseUrl: "https://api.anthropic.com" },
      }),
    },
  );
  assert.equal(requests.length, 10);
  assert.ok(result.ok);
  assert.equal(result.modelIds.length, 10);
});

// probe 证据（/tmp/opencode/bigmodel-probe.md §Endpoint 3）：bigmodel/zai 的 anthropic
// 镜像返回 camelCase 分页字段（hasMore/firstId/lastId）且 hasMore 恒为 false。
test("anthropic discovery accepts legacy camelCase paging fields from bigmodel/zai mirrors", async () => {
  const { fetch, requests } = createRecordingFetch(() => ({
    body: JSON.stringify({
      data: [{ id: "glm-5.3", type: "model", display_name: "GLM-5.3" }],
      hasMore: false,
      firstId: "glm-5.3",
      lastId: "glm-5.3",
    }),
  }));
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: "test-key" },
    {
      fetch,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "anthropic-messages", baseUrl: "https://open.bigmodel.cn/api/anthropic" },
      }),
    },
  );
  assert.equal(requests.length, 1);
  assert.deepEqual(result, { ok: true, modelIds: ["glm-5.3"] });
});

test("snake_case paging fields take precedence when both spellings are present", async () => {
  const { fetch, requests } = createRecordingFetch(() => ({
    // 规范 snake_case 声明没有更多页；镜像拼写 hasMore:true 不得驱动续拉。
    body: JSON.stringify({
      data: [{ id: "model-a" }],
      has_more: false,
      hasMore: true,
      first_id: "model-a",
      firstId: "model-a",
      last_id: "model-a",
      lastId: "model-a",
    }),
  }));
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: "test-key" },
    {
      fetch,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "anthropic-messages", baseUrl: "https://api.anthropic.com" },
      }),
    },
  );
  assert.equal(requests.length, 1);
  assert.deepEqual(result, { ok: true, modelIds: ["model-a"] });
});

// probe 证据（/tmp/opencode/bigmodel-probe.md §Paging check）：镜像可能声称 hasMore
// 却忽略 after_id，每次都从列表头重新返回 —— 首条 id 重复时必须立即停止翻页。
test("anthropic discovery stops paging when a mirror ignores the cursor and repeats the first id", async () => {
  const samePage = {
    data: [{ id: "glm-4.5" }, { id: "glm-4.6" }, { id: "glm-5.3" }],
    has_more: true,
    last_id: "glm-5.3",
  };
  const { fetch, requests } = createRecordingFetch(() => ({
    body: JSON.stringify(samePage),
  }));
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: "test-key" },
    {
      fetch,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "anthropic-messages", baseUrl: "https://open.bigmodel.cn/api/anthropic" },
      }),
    },
  );
  // 第 2 页首条 id 与第 1 页相同 ⇒ 判定游标被忽略，立即停止，且无重复 id。
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url.searchParams.get("after_id"), "glm-5.3");
  assert.ok(result.ok);
  assert.deepEqual(result.modelIds, ["glm-4.5", "glm-4.6", "glm-5.3"]);
});

test("anthropic metadata provides capability hints per model", async () => {
  const { fetch } = createRecordingFetch(() => ({
    body: JSON.stringify({
      data: [
        {
          id: "claude-x",
          max_input_tokens: 200000,
          capabilities: {
            image_input: { supported: true },
            pdf_input: { supported: true },
          },
        },
      ],
    }),
  }));
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: "test-key" },
    {
      fetch,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "anthropic-messages", baseUrl: "https://api.anthropic.com" },
      }),
    },
  );
  assert.deepEqual(result, {
    ok: true,
    modelIds: ["claude-x"],
    modelHints: {
      "claude-x": { contextWindow: 200000, supportsImage: true, supportsPdf: true },
    },
  });
});

test("anthropic max_input_tokens of zero yields no context window hint", async () => {
  const { fetch } = createRecordingFetch(() => ({
    body: JSON.stringify({
      data: [{ id: "claude-zero", max_input_tokens: 0 }],
    }),
  }));
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: "test-key" },
    {
      fetch,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "anthropic-messages", baseUrl: "https://api.anthropic.com" },
      }),
    },
  );
  // 无任何元数据字段 ⇒ 不产生 modelHints 键，仅贡献 id。
  assert.deepEqual(result, { ok: true, modelIds: ["claude-zero"] });
});

test("openai-compatible discovery parses openrouter context_length and input modalities", async () => {
  const { fetch } = createRecordingFetch(() => ({
    body: JSON.stringify({
      data: [
        {
          id: "org/m",
          context_length: 1000000,
          architecture: { input_modalities: ["text", "image", "audio"] },
        },
      ],
    }),
  }));
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: "test-key" },
    {
      fetch,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "openai-chat-completions", baseUrl: "https://openrouter.ai/api/v1" },
      }),
    },
  );
  assert.deepEqual(result, {
    ok: true,
    modelIds: ["org/m"],
    modelHints: {
      "org/m": { contextWindow: 1000000, supportsImage: true },
    },
  });
});

test("capability hints merge deterministically across anthropic pages without overwriting", async () => {
  const { fetch, requests } = createRecordingFetch(({ url }) =>
    url.searchParams.has("after_id")
      ? {
          // 第 2 页：model-x 补充 capabilities（填空不覆盖 ctx）；model-y 只带 ctx，
          // 缺失的 capabilities 不得抹掉第 1 页已提取的 supportsImage。
          body: JSON.stringify({
            data: [
              {
                id: "model-x",
                capabilities: {
                  image_input: { supported: true },
                  pdf_input: { supported: true },
                },
              },
              { id: "model-y", max_input_tokens: 64000 },
            ],
          }),
        }
      : {
          body: JSON.stringify({
            data: [
              { id: "model-x", max_input_tokens: 128000 },
              { id: "model-y", capabilities: { image_input: { supported: true } } },
            ],
            has_more: true,
            last_id: "model-y",
          }),
        },
  );
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: "test-key" },
    {
      fetch,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "anthropic-messages", baseUrl: "https://api.anthropic.com" },
      }),
    },
  );
  assert.equal(requests.length, 2);
  assert.ok(result.ok);
  assert.deepEqual(result.modelHints, {
    "model-x": { contextWindow: 128000, supportsImage: true, supportsPdf: true },
    "model-y": { contextWindow: 64000, supportsImage: true },
  });
});

test("non-200 responses surface as concise discovery errors", async () => {
  const { fetch } = createRecordingFetch(() => ({
    status: 401,
    body: JSON.stringify({ error: { message: "Invalid API key" } }),
  }));
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: "wrong-key" },
    {
      fetch,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "openai-chat-completions", baseUrl: "https://provider.example/v1" },
      }),
    },
  );
  assert.deepEqual(result, { ok: false, error: "HTTP 401" });
});

test("invalid json body surfaces as a discovery error", async () => {
  const { fetch } = createRecordingFetch(() => ({ body: "not-json" }));
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: "test-key" },
    {
      fetch,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "openai-chat-completions", baseUrl: "https://provider.example/v1" },
      }),
    },
  );
  assert.deepEqual(result, { ok: false, error: "invalid model list response" });
});

test("templates without an api base url are unsupported", async () => {
  const { fetch } = createRecordingFetch(() => ({ body: "{}" }));
  const result = await discoverTemplateModels(
    { templateId: "test-template" },
    {
      fetch,
      template: templateView({ access: { type: "api-key" } }),
    },
  );
  assert.deepEqual(result, { ok: false, error: "unsupported template" });
});

test("anthropic discovery normalizes a base url that already contains /v1", async () => {
  const { fetch, requests } = createRecordingFetch(() => ({
    body: JSON.stringify({ data: [{ id: "claude-a" }] }),
  }));
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: "test-key" },
    {
      fetch,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "anthropic-messages", baseUrl: "https://proxy.example.com/v1" },
      }),
    },
  );
  assert.equal(requests.length, 1);
  // 已带 /v1 的 baseUrl 不得重复拼接版本段。
  assert.equal(requests[0].url.toString(), "https://proxy.example.com/v1/models");
  assert.deepEqual(result, { ok: true, modelIds: ["claude-a"] });
});

test("empty model list degrades to a discovery failure (spec: no zero-model success)", async () => {
  const { fetch } = createRecordingFetch(() => ({
    body: JSON.stringify({ data: [] }),
  }));
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: "test-key" },
    {
      fetch,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "openai-chat-completions", baseUrl: "https://api.example.com/v1" },
      }),
    },
  );
  // spec §2：空列表按失败降级，避免 "works · 0 models" 误导用户保存零模型 provider。
  assert.deepEqual(result, { ok: false, error: "no models returned" });
});

test("abort timeouts surface as a concise discovery error", async () => {
  const fetchStub = (async () => {
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  }) as DiscoverTemplateModelsFetch;
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: "test-key" },
    {
      fetch: fetchStub,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "openai-chat-completions", baseUrl: "https://api.example.com/v1" },
      }),
    },
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /timeout/i);
  }
});

test("direct endpoint discovery (custom provider path) reuses the same URL normalization", async () => {
  const { fetch, requests } = createRecordingFetch(() => ({
    body: JSON.stringify({
      data: [
        {
          id: "custom-model",
          context_length: 250000,
          architecture: { input_modalities: ["text", "image"] },
        },
      ],
    }),
  }));
  const result = await discoverModelsForEndpoint(
    {
      apiType: "openai-chat-completions",
      baseUrl: "https://proxy.example.com",
      apiKey: "custom-key",
    },
    { fetch },
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.toString(), "https://proxy.example.com/v1/models");
  assert.equal(requests[0].headers.authorization, "Bearer custom-key");
  assert.deepEqual(result, {
    ok: true,
    modelIds: ["custom-model"],
    modelHints: { "custom-model": { contextWindow: 250000, supportsImage: true } },
  });
});

test("direct endpoint discovery rejects invalid base urls without throwing", async () => {
  const { fetch } = createRecordingFetch(() => ({ body: "{}" }));
  const result = await discoverModelsForEndpoint(
    { apiType: "openai-chat-completions", baseUrl: "not a url", apiKey: "k" },
    { fetch },
  );
  assert.deepEqual(result, { ok: false, error: "invalid base url" });
});

test("createPersonalProvider seeds discovered ids and the resolver publishes executable models", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-model-discovery-"));
  setDataBaseDir(dir);
  const configDir = getAppConfigDir();
  await mkdir(configDir, { recursive: true });
  const runtime = createProviderConfigRuntime({
    zcodeBuiltinFilePath: fileURLToPath(
      new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
    ),
    personalFilePath: join(configDir, "personal.json"),
    personalPollingIntervalMs: false,
    watch: false,
  });
  try {
    await runtime.start();
    const config = await runtime.configService.read();
    // 动态挑选 api-key 模板：内置目录由其它 P1 任务并发清洗（vendor/ollama 去品牌），
    // 不能把测试钉死在某个具体 templateId 上。
    const templateId = config.zcodeBuiltinProviderTemplates
      .entries()
      .find(
        ([, template]) =>
          template.config.access?.type === "api-key" && Boolean(template.config.api?.baseUrl),
      )?.[0];
    assert.ok(templateId, "内置目录必须保留至少一个 api-key + baseUrl 模板");

    const creation = await runtime.configService.createPersonalProvider({
      templateId,
      initialModels: ["discovered-b", "discovered-a", "discovered-b", " "],
    });
    const next = await runtime.configService.read();
    const rule = next.personalProviders.getRule(creation.providerId);
    assert.deepEqual(rule?.config.personalModelIds, ["discovered-b", "discovered-a"]);

    // 启动门禁等价断言：发现到的 id 必须并入 Resolver 的候选模型列表且默认启用
    // （.* 默认 modelRule 提供 enabled=true）。executable 还依赖完整模型 schema 的
    // 必填项收敛（supportsNativeWebSearch 的必填约束正被 P1 目录清理任务移除），
    // 此处不锁定该位，避免与并发 schema 改动互相卡死。
    const resolution = new ProviderConfigResolver().resolve({
      zcodeBuiltinProviders: next.zcodeBuiltinProviders,
      zcodeBuiltinProviderTemplates: next.zcodeBuiltinProviderTemplates,
      personalProviders: next.personalProviders,
      zcodeBuiltinModelRules: next.zcodeBuiltinModelRules,
      personalModels: next.personalModels,
      accountProviders: ProviderConfigMap.empty(),
      personalProviderOrder: next.personalProviderOrder,
    });
    const created = resolution.resolvedProviders.find(
      (provider) => provider.providerId === creation.providerId,
    );
    assert.ok(created);
    const discovered = created.models.filter(
      (model) => model.modelId === "discovered-a" || model.modelId === "discovered-b",
    );
    assert.equal(discovered.length, 2);
    assert.ok(discovered.every((model) => model.enabled));
  } finally {
    runtime.dispose();
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

// P1.1 spec §2：发现 hints 只填目录解析留空的字段，绝不覆盖目录规则；被采纳的 hint 以
// personal 手动配置值落盘（“影子未来目录变更”已被接受并记录在 spec）。
// “目录留空”按排除 .* 兜底 modelRule 后的特定解析判定——兜底为所有未知模型提供
// 200k/无视觉默认值，它不是目录对该模型的认知，否则 hints 在任何模型上都无法生效。
// 用 moonshot-kimi 模板钉死上下文：该 baseUrl 无 providerSite .* 覆盖、无 api 类型
// 覆盖介入 ctx/inputFormat（P1.2 已删除 zai/bigmodel anthropic 端点的站点级
// image/video 覆盖；本测试不依赖端点级规则），四个模型的能力取值均已按当前目录实测钉死。
test("createPersonalProvider persists discovery hints as manual values only where the catalog leaves fields empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-model-discovery-hints-"));
  setDataBaseDir(dir);
  const configDir = getAppConfigDir();
  await mkdir(configDir, { recursive: true });
  const runtime = createProviderConfigRuntime({
    zcodeBuiltinFilePath: fileURLToPath(
      new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
    ),
    personalFilePath: join(configDir, "personal.json"),
    personalPollingIntervalMs: false,
    watch: false,
  });
  try {
    await runtime.start();
    const templateId = "moonshot-kimi";
    const template = (await runtime.configService.read()).zcodeBuiltinProviderTemplates.get(
      templateId,
    );
    assert.ok(template, "内置目录必须保留 moonshot-kimi 模板（能力断言按其 api 上下文钉死）");

    const creation = await runtime.configService.createPersonalProvider({
      templateId,
      initialModels: [
        // 目录无特定规则的模型：ctx/image 由 hints 填空采纳（覆盖 .* 兜底的 200k/false）。
        {
          id: "unknown-model-x",
          hints: { contextWindow: 1_000_000, supportsImage: true },
        },
        // glm-5.3 特定规则已提供 ctx=1M + image=false + video=false：hints 一律不覆盖，
        // 也不得产生 personal 精确规则（否则会冻结字段并影子未来目录变更）。
        { id: "glm-5.3", hints: { contextWindow: 12345, supportsImage: true } },
        // glm-4v-flash 特定规则提供 ctx=16384 + image=true + video=false；pdf 留给兜底
        // ⇒ 仅 pdf hint 采纳，ctx/video 保持目录值（特定规则的显式 false 也是目录认知）。
        {
          id: "glm-4v-flash",
          hints: { contextWindow: 999_999, supportsVideo: true, supportsPdf: true },
        },
        // 纯字符串条目：与旧 initialModelIds 行为完全一致，不产生任何精确规则。
        "plain-id-model",
        // 重复 id 条目：去重保序（首个条目生效）。
        "plain-id-model",
      ],
    });

    const next = await runtime.configService.read();
    const rule = next.personalProviders.getRule(creation.providerId);
    assert.deepEqual(rule?.config.personalModelIds, [
      "unknown-model-x",
      "glm-5.3",
      "glm-4v-flash",
      "plain-id-model",
    ]);

    // unknown-model-x：手动规则落盘（useRecommendedConfig=false ⇒ manual-provider-model）。
    const manualX = next.personalModels.getExactRule(creation.providerId, "unknown-model-x");
    assert.equal(manualX?.type, "manual-provider-model");
    assert.equal(manualX?.config.properties?.contextWindow, 1_000_000);
    assert.equal(manualX?.config.properties?.inputFormat?.supportsImage, true);
    // glm-5.3：目录已提供全部相关字段 ⇒ 不落 personal 精确规则。
    assert.equal(next.personalModels.getExactRule(creation.providerId, "glm-5.3"), undefined);
    // glm-4v-flash：仅 pdf 采纳；手动规则的其余叶子沿用创建时刻的目录有效值。
    const manual4v = next.personalModels.getExactRule(creation.providerId, "glm-4v-flash");
    assert.equal(manual4v?.type, "manual-provider-model");
    assert.equal(manual4v?.config.properties?.contextWindow, 16_384);
    assert.equal(manual4v?.config.properties?.inputFormat?.supportsImage, true);
    assert.equal(manual4v?.config.properties?.inputFormat?.supportsVideo, false);
    assert.equal(manual4v?.config.properties?.inputFormat?.supportsPdf, true);
    // 纯字符串条目不产生精确规则。
    assert.equal(
      next.personalModels.getExactRule(creation.providerId, "plain-id-model"),
      undefined,
    );

    // Resolver 有效配置：hints 填空生效、目录值保持、模型默认启用。
    const resolution = new ProviderConfigResolver().resolve({
      zcodeBuiltinProviders: next.zcodeBuiltinProviders,
      zcodeBuiltinProviderTemplates: next.zcodeBuiltinProviderTemplates,
      personalProviders: next.personalProviders,
      zcodeBuiltinModelRules: next.zcodeBuiltinModelRules,
      personalModels: next.personalModels,
      accountProviders: ProviderConfigMap.empty(),
      personalProviderOrder: next.personalProviderOrder,
    });
    const created = resolution.resolvedProviders.find(
      (provider) => provider.providerId === creation.providerId,
    );
    assert.ok(created);
    const models = new Map(created.models.map((model) => [model.modelId, model]));
    const modelX = models.get("unknown-model-x");
    assert.ok(modelX);
    assert.equal(modelX.config.properties.contextWindow, 1_000_000);
    assert.equal(modelX.config.properties.inputFormat?.supportsImage, true);
    assert.equal(modelX.config.properties.inputFormat?.supportsVideo, false);
    assert.equal(modelX.enabled, true);
    const glm53 = models.get("glm-5.3");
    assert.ok(glm53);
    assert.equal(glm53.config.properties.contextWindow, 1_000_000);
    assert.equal(glm53.config.properties.inputFormat?.supportsImage, false);
    const glm4v = models.get("glm-4v-flash");
    assert.ok(glm4v);
    assert.equal(glm4v.config.properties.contextWindow, 16_384);
    assert.equal(glm4v.config.properties.inputFormat?.supportsVideo, false);
    assert.equal(glm4v.config.properties.inputFormat?.supportsPdf, true);
  } finally {
    runtime.dispose();
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
});

// P1.1 评审补充：镜像返回 has_more=true 但缺 last_id 时（游标无法推进），客户端必须
// 立即停止分页而不是报错或死循环（10 页上限只是兜底）。单请求即收敛。
test("anthropic mirror with has_more but no last_id stops paging after the first request", async () => {
  const { fetch, requests } = createRecordingFetch(() => ({
    body: JSON.stringify({ data: [{ id: "claude-a" }], has_more: true }),
  }));
  const result = await discoverTemplateModels(
    { templateId: "test-template", apiKey: "test-key" },
    {
      fetch,
      template: templateView({
        access: { type: "api-key" },
        api: { type: "anthropic-messages", baseUrl: "https://api.anthropic.com" },
      }),
    },
  );
  assert.equal(requests.length, 1);
  assert.deepEqual(result, { ok: true, modelIds: ["claude-a"] });
});

// P1.1 评审补充（spec §2 影子语义回归锁）：带 hints 保存的模型会落成完整手动规则
// （手动 schema 要求全叶子），此后目录为该模型新增更优规则时，被冻结的手动值永久
// 胜出——这是 spec 已接受并记录的边界，用两阶段目录证明。
test("hint-persisted manual rule shadows a later catalog rule for the same model", async () => {
  const builtinPath = fileURLToPath(
    new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
  );
  const baseCatalog = JSON.parse(await readFile(builtinPath, "utf8"));

  async function startRuntime(
    catalog: object,
    personalFilePath: string,
  ): Promise<{ dir: string; runtime: ReturnType<typeof createProviderConfigRuntime> }> {
    const dir = await mkdtemp(join(tmpdir(), "zcode-hint-shadow-"));
    setDataBaseDir(dir);
    const configDir = getAppConfigDir();
    await mkdir(configDir, { recursive: true });
    const catalogPath = join(configDir, "builtin-test.json");
    await writeFile(catalogPath, `${JSON.stringify(catalog)}\n`);
    const runtime = createProviderConfigRuntime({
      zcodeBuiltinFilePath: catalogPath,
      personalFilePath,
      personalPollingIntervalMs: false,
      watch: false,
    });
    await runtime.start();
    return { dir, runtime };
  }

  // 阶段一：目录无 future-model 特定规则，带 hint 创建（ctx 500_000）。
  const phaseOnePersonalPath = join(getAppConfigDir(), "personal.json");
  const phaseOne = await startRuntime(baseCatalog, phaseOnePersonalPath);
  try {
    const creation = await phaseOne.runtime.configService.createPersonalProvider({
      templateId: "moonshot-kimi",
      initialModels: [{ id: "future-model", hints: { contextWindow: 500_000 } }],
    });
    const snapshot = await phaseOne.runtime.configService.read();
    const manual = snapshot.personalModels.getExactRule(creation.providerId, "future-model");
    assert.equal(manual?.type, "manual-provider-model");
    assert.equal(manual?.config.properties?.contextWindow, 500_000);
  } finally {
    phaseOne.runtime.dispose();
  }
  const phaseOnePersonal = await readFile(phaseOnePersonalPath, "utf8");

  // 阶段二：目录为 future-model 加入 ctx 999_999 特定规则；复用阶段一 personal 配置，
  // 解析结果仍应被冻结的手动值（500_000）覆盖。
  const upgradedCatalog = structuredClone(baseCatalog);
  upgradedCatalog.config.modelConfigRules.modelRules.push({
    modelMatch: ".*future-model(?:[.\\-:/\\[].*)?",
    config: { enabled: true, properties: { contextWindow: 999_999 } },
  });
  const phaseTwoDir = await mkdtemp(join(tmpdir(), "zcode-hint-shadow-p2-"));
  setDataBaseDir(phaseTwoDir);
  const phaseTwoConfigDir = getAppConfigDir();
  await mkdir(phaseTwoConfigDir, { recursive: true });
  const phaseTwoPersonalPath = join(phaseTwoConfigDir, "personal.json");
  await writeFile(phaseTwoPersonalPath, phaseOnePersonal);
  const phaseTwoCatalogPath = join(phaseTwoConfigDir, "builtin-test.json");
  await writeFile(phaseTwoCatalogPath, `${JSON.stringify(upgradedCatalog)}\n`);
  const phaseTwo = createProviderConfigRuntime({
    zcodeBuiltinFilePath: phaseTwoCatalogPath,
    personalFilePath: phaseTwoPersonalPath,
    personalPollingIntervalMs: false,
    watch: false,
  });
  try {
    await phaseTwo.start();
    const snapshot = await phaseTwo.configService.read();
    const providerEntry = [...snapshot.personalProviders.keys()].find((providerId) =>
      providerId.includes("moonshot"),
    );
    assert.ok(providerEntry, "personal provider 未迁移");
    const resolution = new ProviderConfigResolver().resolve({
      zcodeBuiltinProviders: snapshot.zcodeBuiltinProviders,
      zcodeBuiltinProviderTemplates: snapshot.zcodeBuiltinProviderTemplates,
      personalProviders: snapshot.personalProviders,
      zcodeBuiltinModelRules: snapshot.zcodeBuiltinModelRules,
      personalModels: snapshot.personalModels,
      accountProviders: ProviderConfigMap.empty(),
      personalProviderOrder: snapshot.personalProviderOrder,
    });
    const resolved = resolution.resolvedProviders.find(
      (candidate) => candidate.providerId === providerEntry,
    );
    assert.ok(resolved);
    const model = resolved.models.find((entry) => entry.modelId === "future-model");
    assert.ok(model);
    // 冻结的手动值胜过目录后来的更优规则（spec 已接受的影子语义）。
    assert.equal(model.config.properties.contextWindow, 500_000);
  } finally {
    phaseTwo.dispose();
    setDataBaseDir(null);
    await rm(phaseTwoDir, { recursive: true, force: true });
    await rm(phaseOne.dir, { recursive: true, force: true });
  }
});
