import assert from "node:assert/strict";
import test from "node:test";
import { zcodeUserInputResponseSchema } from "@zcode/shared";
import {
  v4AnswerToPlanApprovalResponse,
  v4AnswerToUserInputResponse,
} from "../src/zcode-protocol/interaction-broker.js";
import type { V4InteractionAnswer } from "../src/zcode-protocol-v4/interaction-registry.js";

// specs/bot-inbound-resilience.md §B2.2（3.14.5-alpha.3）：CLI broker 透传——B2 会话
// 失败信号经 respondElicitation 收敛为 v4 resolveInteraction 的
// answer:{action:"decline", content:{failureReason}}。旧映射只回 {action} 并丢弃
// content，failureReason 永远到不了 agent，B2 语义空转。这里钉住两个映射
// （普通 AskUserQuestion + plan-approval 变体）的 decline/cancel content 透传：
// content 原样直传（schema 已接受），failureReason → reason（agent 侧消费方
// userInputResponseToBrokerResult / planApprovalResponseToBrokerResult 只读 reason）。

const FAILURE_REASON = "question send failed: dead channel (test)";

test("v4AnswerToUserInputResponse：decline 携带 failureReason ⇒ content 直传 + failureReason 映射为 reason（wire schema 接受）", () => {
  const answer: V4InteractionAnswer = {
    action: "decline",
    content: { failureReason: FAILURE_REASON },
  };
  const response = v4AnswerToUserInputResponse(answer);
  assert.equal(response.action, "decline");
  assert.deepEqual(response.content, { failureReason: FAILURE_REASON }, "content 必须原样透传");
  assert.equal(
    response.reason,
    FAILURE_REASON,
    "agent 消费方只读 reason，failureReason 必须映射过去",
  );
  // strict schema 守卫：透传后的形状必须是合法 ZCodeUserInputResponse（无 wire 改动）。
  assert.deepEqual(zcodeUserInputResponseSchema.parse(response), {
    action: "decline",
    content: { failureReason: FAILURE_REASON },
    reason: FAILURE_REASON,
  });
});

test("v4AnswerToUserInputResponse：cancel 同样透传 content 与 failureReason→reason", () => {
  const response = v4AnswerToUserInputResponse({
    action: "cancel",
    content: { failureReason: FAILURE_REASON },
  });
  assert.equal(response.action, "cancel");
  assert.deepEqual(response.content, { failureReason: FAILURE_REASON });
  assert.equal(response.reason, FAILURE_REASON);
  zcodeUserInputResponseSchema.parse(response);
});

test("v4AnswerToUserInputResponse：无 content 的 decline/cancel 与 accept 行为保持不变（回归）", () => {
  assert.deepEqual(v4AnswerToUserInputResponse({ action: "decline" }), { action: "decline" });
  assert.deepEqual(v4AnswerToUserInputResponse({ action: "cancel" }), { action: "cancel" });
  assert.deepEqual(v4AnswerToUserInputResponse({ action: "accept" }), {
    action: "accept",
    content: {},
  });
  assert.deepEqual(v4AnswerToUserInputResponse({ action: "accept", content: { answers: {} } }), {
    action: "accept",
    content: { answers: {} },
  });
  // 带 content 但无 failureReason 的 decline：content 透传、不造 reason。
  assert.deepEqual(v4AnswerToUserInputResponse({ action: "decline", content: { other: 1 } }), {
    action: "decline",
    content: { other: 1 },
  });
});

test("v4AnswerToPlanApprovalResponse：decline 携带 failureReason ⇒ content 直传 + failureReason→reason（schema 接受）", () => {
  const response = v4AnswerToPlanApprovalResponse({
    action: "decline",
    content: { failureReason: FAILURE_REASON },
  });
  assert.equal(response.action, "decline");
  assert.deepEqual(response.content, { failureReason: FAILURE_REASON });
  assert.equal(response.reason, FAILURE_REASON, "plan-approval 消费方同样只读 reason");
  zcodeUserInputResponseSchema.parse(response);
});

test("v4AnswerToPlanApprovalResponse：无 content 的 decline 与 allow 类 optionId 行为保持不变（回归）", () => {
  assert.deepEqual(v4AnswerToPlanApprovalResponse({ action: "decline" }), { action: "decline" });
  assert.deepEqual(v4AnswerToPlanApprovalResponse({ action: "cancel" }), { action: "cancel" });
  assert.deepEqual(v4AnswerToPlanApprovalResponse({ optionId: "allowOnce" }), {
    action: "accept",
    content: { answer: "approve" },
  });
  assert.deepEqual(
    v4AnswerToPlanApprovalResponse({ action: "accept", content: { answer: "approve" } }),
    { action: "accept", content: { answer: "approve" } },
  );
});
