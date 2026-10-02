import assert from "node:assert/strict";
import test from "node:test";
import { getBotRuntimeErrorDetail } from "../src/botsUi.ts";
import type { BotRuntimeInfo } from "@zcode/shared";

// specs/bot-provider-network.md F0 验收场景 6（逻辑层）：错误详情对所有 provider 可见。
// UI 测试基建（node --test + 纯逻辑用例）没有 React 渲染 harness，因此这里钉住
// “error 状态 → 原始 runtime.message 作为详情”的展示契约；渲染装配
// （BotSummaryCard 次行 + ProviderSettingsCard 详情面板）由 typecheck 覆盖。

function runtime(patch: Partial<BotRuntimeInfo>): BotRuntimeInfo {
  return {
    botId: "bot-test-1",
    provider: "telegram",
    status: "error",
    ...patch,
  };
}

test("telegram error 状态返回原始 message 作为详情", () => {
  const detail = getBotRuntimeErrorDetail(
    runtime({
      provider: "telegram",
      messageId: "bots.runtime.telegramPollingFailedRetrying",
      message: "Telegram polling failed; retrying. (fetch failed: ETIMEDOUT)",
    }),
  );
  assert.equal(detail, "Telegram polling failed; retrying. (fetch failed: ETIMEDOUT)");
});

test("weixin error 状态同样返回详情（对所有 provider 生效）", () => {
  const detail = getBotRuntimeErrorDetail(
    runtime({ provider: "weixin", message: "Weixin polling failed: HTTP 500" }),
  );
  assert.equal(detail, "Weixin polling failed: HTTP 500");
});

test("非 error 状态与缺失 message 返回 null（回退到 i18n unknownError / 不渲染次行）", () => {
  assert.equal(
    getBotRuntimeErrorDetail(
      runtime({ status: "polling", messageId: "bots.runtime.telegramLongPollingRunning" }),
    ),
    null,
  );
  assert.equal(getBotRuntimeErrorDetail(runtime({ message: undefined })), null);
  assert.equal(getBotRuntimeErrorDetail(runtime({ message: "   " })), null);
  assert.equal(getBotRuntimeErrorDetail(undefined), null);
});
