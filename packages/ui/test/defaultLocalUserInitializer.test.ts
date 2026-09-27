import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LOCAL_USER, registerDefaultLocalUserIfAbsent } from "../src/store/index.ts";

// P3 ruling 6 休眠用户框架：UI 单测 harness（node --test，无 DOM）无法实例化
// createZCodeStore（创建期会读写 document/localStorage），因此这里测试 initializer
// 的纯函数语义；「authSessionSeq 仅在 null→user 时 +1」由 store 的 setUser 实现保证，
// StoreProvider 挂载 effect 只调用一次 registerDefaultLocalUserIfAbsent。

interface FakeState {
  user: { id: string } | null;
  authSessionSeq: number;
  setUserCalls: number;
  setUser(user: { id: string } | null): void;
}

function createFakeState(initialUser: { id: string } | null): FakeState {
  const state = {
    user: initialUser,
    authSessionSeq: 0,
    setUserCalls: 0,
    setUser(user: { id: string } | null) {
      state.setUserCalls += 1;
      // 与 store 的 setUser 口径一致：仅在 null→user 时递增 authSessionSeq。
      state.authSessionSeq =
        state.user === null && user !== null ? state.authSessionSeq + 1 : state.authSessionSeq;
      state.user = user;
    },
  };
  return state;
}

test("default user constant matches the dormant-user framework ruling", () => {
  assert.deepEqual(DEFAULT_LOCAL_USER, {
    id: "user",
    username: "user",
    displayName: "User",
  });
});

test("initializer registers the default local user exactly once when user is null", () => {
  const state = createFakeState(null);
  assert.equal(registerDefaultLocalUserIfAbsent(state), true);
  assert.equal(state.setUserCalls, 1);
  assert.equal(state.user?.id, "user");
  // authSessionSeq 语义：null→user 只递增一次（0→1）。
  assert.equal(state.authSessionSeq, 1);

  // 幂等：已有用户（包括内置用户本身）时不再注册。
  assert.equal(registerDefaultLocalUserIfAbsent(state), false);
  assert.equal(state.setUserCalls, 1);
  assert.equal(state.authSessionSeq, 1);
});

test("initializer is a no-op when a user is already present", () => {
  const state = createFakeState({ id: "alpha-legacy" });
  assert.equal(registerDefaultLocalUserIfAbsent(state), false);
  assert.equal(state.setUserCalls, 0);
  assert.equal(state.user?.id, "alpha-legacy");
  assert.equal(state.authSessionSeq, 0);
});
