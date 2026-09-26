import assert from "node:assert/strict";
import test from "node:test";
import { appSettingsPatchSchema } from "../../shared/src/validationAppSettings.ts";
import { normalizeSettingsPatch } from "../../services/src/setting/normalizeSettingsPatch.ts";
import {
  buildWizardSkipSettings,
  shouldShowLoginApiKeyLink,
} from "../src/login/LoginApiKeyForm.helpers.ts";

test("wizard skip writes providerOnboardingDismissedAt as an ISO string", () => {
  const now = new Date("2026-01-02T03:04:05.678Z");
  // 跳过只记录跳过时间，不写 providerFamilyDomain 等旧字段（P1 删除）或空 API Key。
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
