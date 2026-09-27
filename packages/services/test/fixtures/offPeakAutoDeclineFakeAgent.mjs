// 闲时免打扰 wiring 测试的假 Agent：与 host 以 stdio 换行 JSON 帧通信（ZCode Protocol 无 jsonrpc 字段）。
// 行为契约（供 packages/services/test/offPeakAutoDeclineWiring.test.ts 断言）：
// 1. 收到 host 首个请求（session/subscribe 等）时回复合法结果，并按脚本一次性发出 4 个反向交互请求：
//    tracked/untracked 会话 × interaction/requestPermission / interaction/requestUserInput；
//    host 在 wireClient 里注册的 onRequest 处理器先于任何 host→agent 请求挂上，
//    因此「首个 host 请求到达」即可保证反向请求会被服务层处理。
// 2. 收到 host 对反向请求的响应后，把整帧逐行追加写入 FAKE_AGENT_RESULT_FILE：
//    tracked 会话应收到 deny/decline 自动应答；untracked 会话正常语义下保持挂起（无响应可写）。
// 3. stdin EOF（host 回收进程树）后静默退出。
import { appendFile } from "node:fs/promises";
import readline from "node:readline";

const resultFile = process.env.FAKE_AGENT_RESULT_FILE;
const trackedSession = process.env.FAKE_AGENT_TRACKED_SESSION ?? "off-peak-tracked";
const untrackedSession = process.env.FAKE_AGENT_UNTRACKED_SESSION ?? "regular-untracked";

if (!resultFile) {
  process.stderr.write("FAKE_AGENT_RESULT_FILE is required\n");
  process.exit(1);
}

function permissionParams(sessionId, requestId) {
  return {
    requestId,
    sessionId,
    turnId: "turn-1",
    toolCallId: `call-${requestId}`,
    toolName: "Bash",
    reason: "run repository tests",
    riskLevel: "medium",
    input: { command: "pnpm test" },
    options: [
      {
        optionId: "allow-once",
        kind: "allow_once",
        name: "Allow",
        response: { decision: "allow" },
      },
    ],
  };
}

function userInputParams(sessionId, requestId) {
  return {
    requestId,
    sessionId,
    turnId: "turn-1",
    questions: [
      {
        question: "Proceed with the nightly cleanup?",
        header: "Confirm",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      },
    ],
  };
}

const reverseRequests = [
  {
    id: 9001,
    method: "interaction/requestPermission",
    params: permissionParams(trackedSession, "perm-tracked"),
  },
  {
    id: 9002,
    method: "interaction/requestUserInput",
    params: userInputParams(trackedSession, "input-tracked"),
  },
  {
    id: 9003,
    method: "interaction/requestPermission",
    params: permissionParams(untrackedSession, "perm-untracked"),
  },
  {
    id: 9004,
    method: "interaction/requestUserInput",
    params: userInputParams(untrackedSession, "input-untracked"),
  },
];
const awaitedResponseIds = new Set(reverseRequests.map((request) => request.id));

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

let reverseFired = false;
function fireReverseRequestsOnce() {
  if (reverseFired) return;
  reverseFired = true;
  for (const request of reverseRequests) send(request);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (message && "method" in message && "id" in message) {
    // host→agent 请求：只回 wiring 测试会触发的两个方法，其余给空结果兜底。
    if (message.method === "session/list") {
      send({ id: message.id, result: { sessions: [] } });
    } else if (message.method === "session/subscribe") {
      const sessionId =
        typeof message.params?.sessionId === "string" ? message.params.sessionId : trackedSession;
      send({ id: message.id, result: { sessionId, eventSeq: 0, events: [] } });
    } else {
      send({ id: message.id, result: {} });
    }
    fireReverseRequestsOnce();
    return;
  }
  if (
    message &&
    "id" in message &&
    ("result" in message || "error" in message) &&
    awaitedResponseIds.has(message.id)
  ) {
    void appendFile(resultFile, `${JSON.stringify(message)}\n`, "utf8").catch(() => {});
  }
});
rl.on("close", () => {
  process.exit(0);
});
