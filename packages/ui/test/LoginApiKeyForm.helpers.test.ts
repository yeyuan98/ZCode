import assert from "node:assert/strict";
import test from "node:test";
import { appSettingsPatchSchema } from "../../shared/src/validationAppSettings.ts";
import { normalizeSettingsPatch } from "../../services/src/setting/normalizeSettingsPatch.ts";
import {
  buildInitialModels,
  buildWizardSkipSettings,
  shouldShowLoginApiKeyLink,
} from "../src/login/LoginApiKeyForm.helpers.ts";

test("wizard skip writes providerOnboardingDismissedAt as an ISO string", () => {
  const now = new Date("2026-01-02T03:04:05.678Z");
  // 跳过只记录跳过时间，不写旧连接字段（P1 已删除）或空 API Key。
  const patch = buildWizardSkipSettings(now);
  assert.deepEqual(patch, { providerOnboardingDismissedAt: "2026-01-02T03:04:05.678Z" });
});

test("providerOnboardingDismissedAt is optional and accepts ISO timestamps in the patch schema", () => {
  // 必须可选：settings 加载走宽松 zod 解析并整体回退默认值，必填新字段会把老用户设置工厂重置。
  assert.equal(appSettingsPatchSchema.safeParse({}).success, true);
  assert.equal(
    appSettingsPatchSchema.safeParse({ providerOnboardingDismissedAt: "2026-01-02T03:04:05.678Z" })
      .success,
    true,
  );
  assert.equal(
    appSettingsPatchSchema.safeParse({ providerOnboardingDismissedAt: "not-a-date" }).success,
    false,
  );
});

test("empty-string providerOnboardingDismissedAt resets to undefined before validation", () => {
  // RPC 传输会吞掉 undefined；重置跳过状态用空串表示，normalizeSettingsPatch 负责归一。
  const normalized = normalizeSettingsPatch({
    providerOnboardingDismissedAt: "",
  }) as { providerOnboardingDismissedAt?: string };
  assert.equal("providerOnboardingDismissedAt" in normalized, true);
  assert.equal(normalized.providerOnboardingDismissedAt, undefined);
  assert.equal(appSettingsPatchSchema.safeParse(normalized).success, true);
});

test("get-key link only shows while the key input is empty", () => {
  assert.equal(shouldShowLoginApiKeyLink("", "https://example.com/keys"), true);
  assert.equal(shouldShowLoginApiKeyLink("  ", "https://example.com/keys"), true);
  assert.equal(shouldShowLoginApiKeyLink("sk-123", "https://example.com/keys"), false);
  assert.equal(shouldShowLoginApiKeyLink("", undefined), false);
});

test("buildInitialModels keeps plain ids as strings and attaches hints per id", () => {
  // 无 hints（端点不提供元数据）：全部保持字符串形态，与旧 initialModelIds 行为一致。
  assert.deepEqual(buildInitialModels(["model-a", "model-b"]), ["model-a", "model-b"]);
  assert.deepEqual(buildInitialModels(["model-a"], undefined), ["model-a"]);
  // 有 hints 的模型用对象形态携带；无关 id 的 hints 条目被忽略。
  assert.deepEqual(
    buildInitialModels(["model-a", "model-b"], {
      "model-b": { contextWindow: 250000, supportsImage: true },
    }),
    ["model-a", { id: "model-b", hints: { contextWindow: 250000, supportsImage: true } }],
  );
  // 空 hints 对象不产生对象形态（provider 层会把无字段 hints 归一为纯 id）。
  assert.deepEqual(buildInitialModels(["model-a"], { "model-a": {} }), ["model-a"]);
});
