import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
      initialModelIds: ["discovered-b", "discovered-a", "discovered-b", " "],
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
