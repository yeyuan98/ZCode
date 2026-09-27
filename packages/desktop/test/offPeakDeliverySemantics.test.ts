import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hostOffPeakRunMessageSchema } from "@zcode/shared";
// modelExecutionSchema 未进 shared 根出口（仅协议内部消费），测试按仓库相对路径直取源文件。
import { modelExecutionSchema } from "../../shared/src/model-execution.js";

// P3 交付语义回归钉：闲时派发链保持 desktop-continuous 实时语义不变
// （web-remote-replayable 恢复链路不涉足），且协议面不再携带票据鉴权/位次字段。

const HOST_ENTRY = fileURLToPath(new URL("../src/host/index.ts", import.meta.url));

test("modelExecutionSchema：strict 拒绝已删除的 requestAuth 注入字段", () => {
  const parsed = modelExecutionSchema.parse({
    selectionScope: "execution",
    memoryExtraction: "skip",
    subagents: { foregroundModel: "submission", background: "deny" },
  });
  assert.equal(parsed.selectionScope, "execution");
  assert.throws(() =>
    modelExecutionSchema.parse({
      selectionScope: "execution",
      // P3：闲时票据鉴权注入已删除——协议面不允许再出现该字段。
      requestAuth: { apiKey: "should-be-rejected" },
    }),
  );
});

test("hostOffPeakRunMessageSchema：票据字段不在协议面（未知键被剥离）", () => {
  const message = hostOffPeakRunMessageSchema.parse({
    type: "off-peak-run",
    offPeakTaskId: "offpeak-x",
    workspacePath: "/w",
    prompt: "p",
    permissionMode: "build",
    modelSelection: { providerId: "p", modelId: "m" },
    conversationId: "c",
    sessionId: "c",
    // 该 schema 宽松传输（未知键 strip 而非 throw）；断言票据字段不会进入解析结果。
    serverTicketId: "ticket-1",
  });
  assert.equal(message.offPeakTaskId, "offpeak-x");
  assert.equal(
    (message as Record<string, unknown>).serverTicketId,
    undefined,
    "票据字段必须被剥离",
  );
});

test("源码契约：闲时派发 sendPrompt 保持 desktop-continuous（不引入 web 回放语义）", async () => {
  // dispatchOffPeakRun 位于 host 进程入口（含大量装配副作用），无法在 node:test 中
  // 直接驱动；此处以源码契约钉住 delivery 语义——改动的 review 责任由该测试兜底。
  const source = await readFile(HOST_ENTRY, "utf8");
  const dispatchStart = source.indexOf("async function dispatchOffPeakRun");
  assert.ok(dispatchStart > 0, "dispatchOffPeakRun 必须存在");
  // 函数体终点用后继声明锚定（签名内也有 "}"，不能用首个 "\n}" 判界）。
  const dispatchEnd = source.indexOf("interface CronRunDispatchRequest", dispatchStart);
  assert.ok(dispatchEnd > dispatchStart, "dispatchOffPeakRun 后继声明锚点必须存在");
  const dispatchSource = source.slice(dispatchStart, dispatchEnd);
  assert.match(dispatchSource, /clientMode:\s*"desktop-continuous"/);
  assert.doesNotMatch(dispatchSource, /web-remote-replayable/);
  // P3：requestAuth 注入已删除（注释提及不算）；offPeakTaskId/offPeakRunType 归属字段保留。
  assert.doesNotMatch(dispatchSource, /requestAuth\s*[:=]/);
  assert.doesNotMatch(dispatchSource, /buildRequestAuth/);
  assert.match(dispatchSource, /offPeakTaskId:\s*request\.offPeakTaskId/);
  assert.match(dispatchSource, /offPeakRunType/);
});
