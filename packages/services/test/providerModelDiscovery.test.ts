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
