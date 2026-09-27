import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { zcodePermissionResponseSchema, zcodeUserInputResponseSchema } from "@zcode/shared";
import { createZCodeAgentService } from "../src/zcode-agent/zcodeAgentService.js";
import { createOffPeakInteractionPolicy } from "../src/session/offPeakInteractionPolicy.js";

// 闲时免打扰（P3 binding policy）服务层 wiring 验证：真实 createZCodeAgentService + 真
// ZCodeProtocolClient/ZCodeStdioTransport + 假 Agent 子进程（node fixtures 脚本），驱动
// host 侧 interaction/requestPermission / interaction/requestUserInput 反向请求拦截：
// - 策略登记（TRUE）的 session：permission → {decision:"deny"}、userInput → {action:"decline"}，
//   且不再向 UI 广播交互请求事件；
// - 未登记（FALSE/untracked）的 session：不自动应答（挂起等 UI resolveInteraction），
//   照常广播 permission.request / userInput.request 会话事件。
// 装配与 packages/desktop/src/host/index.ts 一致：createOffPeakInteractionPolicy 真实实例
// 经 shouldDeclineInteractionForSession 注入（host 派发成功 track、终态/订阅释放 untrack）。

const TRACKED_SESSION = "off-peak-active-turn";
const UNTRACKED_SESSION = "regular-session";
const PERMISSION_TRACKED_RESPONSE_ID = 9001;
const USER_INPUT_TRACKED_RESPONSE_ID = 9002;

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "offPeakAutoDeclineFakeAgent.mjs",
);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function readResponseFrames(path: string): Promise<Array<{ id: number; result?: unknown }>> {
  try {
    const content = await readFile(path, "utf8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { id: number; result?: unknown });
  } catch {
    return [];
  }
}

test("闲时免打扰 wiring：登记 session 权限/交互自动拒绝；未登记 session 正常挂起并广播事件", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-offpeak-wiring-"));
  const resultFile = join(dir, "reverse-responses.ndjson");
  // 与 desktop host 相同：真实 policy 实例，派发成功后登记活跃 turn。
  const policy = createOffPeakInteractionPolicy();
  policy.track(TRACKED_SESSION);
  const service = createZCodeAgentService({
    commandResolver: () => ({
      command: process.execPath,
      args: [FIXTURE],
      cwd: dir,
      env: {
        FAKE_AGENT_RESULT_FILE: resultFile,
        FAKE_AGENT_TRACKED_SESSION: TRACKED_SESSION,
        FAKE_AGENT_UNTRACKED_SESSION: UNTRACKED_SESSION,
      },
    }),
    // 与 packages/desktop/src/host/index.ts 的注入同构：session 归因按 policy 注册表裁决。
    shouldDeclineInteractionForSession: (sessionId) => policy.shouldDecline(sessionId),
  });
  const trackedEvents: Array<{ type: string }> = [];
  const untrackedEvents: Array<{ type: string }> = [];
  const trackedSubscription = service.onDynamicSessionEvent({
    workspacePath: dir,
    sessionId: TRACKED_SESSION,
    deliveryKind: "desktop-continuous",
  })((event) => trackedEvents.push(event));
  const untrackedSubscription = service.onDynamicSessionEvent({
    workspacePath: dir,
    sessionId: UNTRACKED_SESSION,
    deliveryKind: "desktop-continuous",
  })((event) => untrackedEvents.push(event));
  try {
    // 订阅建立会拉起假 Agent 并 wireClient；假 Agent 随后发出 4 个反向交互请求。
    // 等待 tracked 两个请求收到自动应答（deny/decline）。
    const deadline = Date.now() + 30_000;
    let frames: Array<{ id: number; result?: unknown }> = [];
    while (Date.now() < deadline) {
      frames = await readResponseFrames(resultFile);
      const autoAnswered = frames.filter(
        (frame) =>
          frame.id === PERMISSION_TRACKED_RESPONSE_ID ||
          frame.id === USER_INPUT_TRACKED_RESPONSE_ID,
      );
      if (autoAnswered.length === 2) break;
      await sleep(100);
    }

    const permissionFrame = frames.find((frame) => frame.id === PERMISSION_TRACKED_RESPONSE_ID);
    assert.ok(permissionFrame, "登记 session 的权限请求应收到自动拒绝响应");
    // 用真实协议响应 schema 校验 deny 帧形状（防测试与协议漂移）。
    const permission = zcodePermissionResponseSchema.parse(permissionFrame.result);
    assert.equal(permission.decision, "deny");
    assert.match(permission.reason ?? "", /off-peak/);

    const userInputFrame = frames.find((frame) => frame.id === USER_INPUT_TRACKED_RESPONSE_ID);
    assert.ok(userInputFrame, "登记 session 的交互请求应收到自动拒绝响应");
    const userInput = zcodeUserInputResponseSchema.parse(userInputFrame.result);
    assert.equal(userInput.action, "decline");
    assert.match(userInput.reason ?? "", /off-peak/);

    // 未登记 session 不得被自动应答：宽限期内仍无 9003/9004 帧（挂起等 UI 决议）。
    await sleep(800);
    frames = await readResponseFrames(resultFile);
    assert.equal(
      frames.some((frame) => frame.id === 9003 || frame.id === 9004),
      false,
      "未登记 session 的交互请求应保持挂起，不得自动应答",
    );

    // 未登记 session 的正常语义：host 广播 permission.request / userInput.request。
    const untrackedDeadline = Date.now() + 10_000;
    while (Date.now() < untrackedDeadline) {
      if (
        untrackedEvents.some((event) => event.type === "permission.request") &&
        untrackedEvents.some((event) => event.type === "userInput.request")
      ) {
        break;
      }
      await sleep(100);
    }
    assert.equal(
      untrackedEvents.some((event) => event.type === "permission.request"),
      true,
      "未登记 session 的权限请求应广播给 UI",
    );
    assert.equal(
      untrackedEvents.some((event) => event.type === "userInput.request"),
      true,
      "未登记 session 的交互请求应广播给 UI",
    );
    // 登记 session 走自动拒绝路径：不向 UI 广播任何交互请求事件。
    assert.equal(
      trackedEvents.some(
        (event) => event.type === "permission.request" || event.type === "userInput.request",
      ),
      false,
      "登记 session 的交互请求已被自动拒绝，不应广播给 UI",
    );
  } finally {
    trackedSubscription.dispose();
    untrackedSubscription.dispose();
    await service.disposeAllAndWait();
    await rm(dir, { recursive: true, force: true });
  }
});
