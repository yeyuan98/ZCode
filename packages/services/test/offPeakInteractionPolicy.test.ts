import assert from "node:assert/strict";
import test from "node:test";
import { createOffPeakInteractionPolicy } from "../src/session/offPeakInteractionPolicy.js";

// 闲时免打扰（P3 binding policy）：归因严格按「session 的活跃 turn 属于闲时派发」。
// host 派发成功登记、终态/订阅释放摘除；未登记的会话（普通 turn）不受影响。

test("登记期间该 session 的交互应被拒绝；摘除后恢复普通语义", () => {
  const policy = createOffPeakInteractionPolicy();
  assert.equal(policy.shouldDecline("session-a"), false, "未登记 = 普通 turn，不拦截");

  policy.track("session-a");
  assert.equal(policy.shouldDecline("session-a"), true, "闲时活跃 turn 期间拒绝交互");
  // 同 host 其它会话的普通 turn 不受影响。
  assert.equal(policy.shouldDecline("session-b"), false);

  policy.untrack("session-a");
  assert.equal(policy.shouldDecline("session-a"), false, "终态回写后恢复普通交互");
});

test("归因按 session 粒度隔离：多个并行闲时 run 独立登记/摘除", () => {
  const policy = createOffPeakInteractionPolicy();
  policy.track("session-a");
  policy.track("session-b");
  policy.untrack("session-a");
  assert.equal(policy.shouldDecline("session-a"), false);
  assert.equal(policy.shouldDecline("session-b"), true, "另一 run 未终态，仍拒绝");
});

test("重复 track/untrack 幂等；未登记 session 的 untrack 无副作用", () => {
  const policy = createOffPeakInteractionPolicy();
  policy.track("session-a");
  policy.track("session-a");
  assert.equal(policy.shouldDecline("session-a"), true);
  policy.untrack("session-a");
  policy.untrack("session-a");
  policy.untrack("session-unknown");
  assert.equal(policy.shouldDecline("session-a"), false);
});

test("策略实例互不串扰（多 host/多测试并发驱动各自注册表）", () => {
  const first = createOffPeakInteractionPolicy();
  const second = createOffPeakInteractionPolicy();
  first.track("session-shared");
  assert.equal(second.shouldDecline("session-shared"), false);
});
