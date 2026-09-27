import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { InitialModelEntry } from "@zcode/provider";
import type { DiscoverTemplateModelsFetch } from "../src/model-provider/providerModelDiscovery.js";
import { createProviderRuntime } from "../src/model-provider/providerRuntime.js";
import { getAppConfigDir, setDataBaseDir } from "../src/paths.js";

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

async function withDiscoveryRuntime(
  fetch: DiscoverTemplateModelsFetch,
  run: (runtime: Awaited<ReturnType<typeof createProviderRuntime>>) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zcode-provider-discovery-facade-"));
  setDataBaseDir(dir);
  const configDir = getAppConfigDir();
  await mkdir(configDir, { recursive: true });
  const runtime = createProviderRuntime({
    zcodeBuiltinFilePath: fileURLToPath(
      new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
    ),
    personalFilePath: join(configDir, "personal.json"),
    personalPollingIntervalMs: false,
    watch: false,
    discoveryFetch: fetch,
  });
  try {
    await runtime.start();
    await run(runtime);
  } finally {
    runtime.dispose();
    setDataBaseDir(null);
    await rm(dir, { recursive: true, force: true });
  }
}

// P1.1 spec §4：设置页“发现模型”走 provider 自己的有效配置（模板基线 + personal 覆盖），
// 服务端取 Key 直连端点；批量合并对 personal 现有 id、builtin 继承 id 静默去重。
test("discoverProviderModels uses the provider's own config and addPersonalModels merges only new ids", async () => {
  await withDiscoveryRuntime(
    createRecordingFetch(() => ({
      body: JSON.stringify({
        data: [
          { id: "existing-personal-model" },
          { id: "kimi-k3" },
          {
            id: "brand-new-model",
            context_length: 250000,
            architecture: { input_modalities: ["text", "image"] },
          },
          { id: "brand-new-model" },
        ],
      }),
    })).fetch,
    async (runtime) => {
      const service = runtime.providerSettings;
      const creation = await service.createPersonalProvider({
        templateId: "moonshot-kimi",
        initialConfig: {
          api: { type: "openai-chat-completions", baseUrl: "https://discover.example/v1" },
          access: { type: "api-key", apiKey: "sk-facade-secret" },
        },
        initialModels: ["existing-personal-model"],
      });
      const discovery = await service.discoverProviderModels(creation.providerId);
      assert.ok(discovery.ok);
      assert.deepEqual(discovery.modelIds, [
        "brand-new-model",
        "existing-personal-model",
        "kimi-k3",
      ]);
      assert.deepEqual(discovery.modelHints, {
        "brand-new-model": { contextWindow: 250000, supportsImage: true },
      });

      const models: InitialModelEntry[] = discovery.modelIds.map((id) => {
        const hints = discovery.modelHints?.[id];
        return hints ? { id, hints } : id;
      });
      const addedCount = await service.addPersonalModels(creation.providerId, models);
      // existing-personal-model（personal 已有）与 kimi-k3（模板 builtin 继承）都被跳过。
      assert.equal(addedCount, 1);

      const view = await service.getView();
      const provider = view.providers.find((item) => item.providerId === creation.providerId);
      assert.ok(provider);
      const personalIds = provider.models
        .filter((model) => !model.builtin)
        .map((model) => model.modelId);
      assert.deepEqual(personalIds, ["existing-personal-model", "brand-new-model"]);
      const builtinIds = provider.models
        .filter((model) => model.builtin)
        .map((model) => model.modelId);
      assert.ok(builtinIds.includes("kimi-k3"), "模板 builtin id 保持 builtin，不重复落 personal");
      // hints 经批量合并落成 personal 手动规则（与创建路径同一 gap-filling）。
      const config = await runtime.configService.read();
      const manual = config.personalModels.getExactRule(creation.providerId, "brand-new-model");
      assert.equal(manual?.type, "manual-provider-model");
      assert.equal(manual?.config.properties?.contextWindow, 250000);
      assert.equal(manual?.config.properties?.inputFormat?.supportsImage, true);

      // 幂等：再次合并同一批发现结果时全部命中重复，返回 0 且成员不变。
      const repeatCount = await service.addPersonalModels(creation.providerId, models);
      assert.equal(repeatCount, 0);
      const repeatedView = await service.getView();
      const repeatedProvider = repeatedView.providers.find(
        (item) => item.providerId === creation.providerId,
      );
      assert.deepEqual(
        repeatedProvider?.models.filter((model) => !model.builtin).map((m) => m.modelId),
        ["existing-personal-model", "brand-new-model"],
      );
    },
  );
});

// P1.1 spec §4 关键安全断言：Key 在服务端使用（请求头携带），但绝不回显进错误文本。
test("discoverProviderModels error text for a 401 never contains the API key", async () => {
  const { fetch, requests } = createRecordingFetch(() => ({
    status: 401,
    body: JSON.stringify({ error: { message: "Invalid API key" } }),
  }));
  await withDiscoveryRuntime(fetch, async (runtime) => {
    const service = runtime.providerSettings;
    const creation = await service.createPersonalProvider({
      initialConfig: {
        api: { type: "openai-chat-completions", baseUrl: "https://provider.example/v1" },
        access: { type: "api-key", apiKey: "sk-secret-DO-NOT-LEAK" },
      },
    });
    const result = await service.discoverProviderModels(creation.providerId);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /401/);
      assert.ok(!result.error.includes("sk-secret-DO-NOT-LEAK"), "错误文本不得包含 API Key");
    }
    // Key 确实在服务端请求里使用了（服务端解析、服务端消费）。
    assert.equal(requests[0]?.headers.authorization, "Bearer sk-secret-DO-NOT-LEAK");
  });
});

// 无 access 的 provider（如 ollama 模板实例）按无 Key 匿名发现，不伪造鉴权头。
test("discoverProviderModels works keyless for a provider without an access config", async () => {
  const { fetch, requests } = createRecordingFetch(() => ({
    body: JSON.stringify({ data: [{ id: "llama-local" }, { id: "qwen-local" }] }),
  }));
  await withDiscoveryRuntime(fetch, async (runtime) => {
    const service = runtime.providerSettings;
    const creation = await service.createPersonalProvider({
      templateId: "ollama",
      initialConfig: {
        api: { type: "openai-chat-completions", baseUrl: "http://localhost:11434/v1" },
      },
    });
    const result = await service.discoverProviderModels(creation.providerId);
    assert.ok(result.ok);
    if (result.ok) {
      assert.deepEqual(result.modelIds, ["llama-local", "qwen-local"]);
    }
    assert.equal(requests[0]?.url.toString(), "http://localhost:11434/v1/models");
    assert.equal(requests[0]?.headers.authorization, undefined);
    assert.equal(requests[0]?.headers["x-api-key"], undefined);
  });
});

test("discoverProviderModels rejects unknown providers and providers without a base url", async () => {
  await withDiscoveryRuntime(
    createRecordingFetch(() => ({ body: "{}" })).fetch,
    async (runtime) => {
      const service = runtime.providerSettings;
      const missing = await service.discoverProviderModels("no-such-provider");
      assert.deepEqual(missing, { ok: false, error: "provider not found" });
      const creation = await service.createPersonalProvider({});
      const noBaseUrl = await service.discoverProviderModels(creation.providerId);
      assert.deepEqual(noBaseUrl, { ok: false, error: "provider has no base url" });
    },
  );
});

// 批量合并与 createPersonalProvider 的 hints gap-filling 等价（spec §2 / §4）：
// 目录已覆盖的模型不落手动规则，目录留空的字段按 hints 采纳为 personal 手动值。
test("addPersonalModels hint gap-filling matches createPersonalProvider semantics", async () => {
  const hintEntries: InitialModelEntry[] = [
    { id: "glm-5.3", hints: { contextWindow: 12345, supportsImage: true } },
    { id: "unknown-model-x", hints: { contextWindow: 1_000_000, supportsImage: true } },
  ];
  await withDiscoveryRuntime(
    createRecordingFetch(() => ({ body: "{}" })).fetch,
    async (runtime) => {
      const service = runtime.providerSettings;
      const seeded = await service.createPersonalProvider({
        templateId: "moonshot-kimi",
        initialModels: hintEntries,
      });
      const merged = await service.createPersonalProvider({ templateId: "moonshot-kimi" });
      const addedCount = await service.addPersonalModels(merged.providerId, hintEntries);
      assert.equal(addedCount, 2);

      const config = await runtime.configService.read();
      for (const providerId of [seeded.providerId, merged.providerId]) {
        // 目录对 glm-5.3 已提供全部相关字段 ⇒ 不产生 personal 精确规则（不影子目录）。
        assert.equal(
          config.personalModels.getExactRule(providerId, "glm-5.3"),
          undefined,
          `${providerId}: 目录覆盖模型不得落手动规则`,
        );
        // unknown-model-x 仅命中 .* 兜底 ⇒ hints 填空落成手动值。
        const manual = config.personalModels.getExactRule(providerId, "unknown-model-x");
        assert.equal(manual?.type, "manual-provider-model");
        assert.equal(manual?.config.properties?.contextWindow, 1_000_000);
        assert.equal(manual?.config.properties?.inputFormat?.supportsImage, true);
        assert.deepEqual(config.personalProviders.getRule(providerId)?.config.personalModelIds, [
          "glm-5.3",
          "unknown-model-x",
        ]);
      }
    },
  );
});
