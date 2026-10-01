import { disposeServiceResourcesAndWait, getAppConfigDir } from "@zcode/services/node";
import { ChannelClient, SocketProtocol } from "@zcode/rpc";
import {
  ZCODE_VERSION,
  SERVICE_AUTHORITY_MODE_ENV,
  formatLogPrefix,
  formatZodError,
  helloAckMessageSchema,
} from "@zcode/shared";
import type { HelloMessage, HelloAckMessage } from "@zcode/shared";
import { createStdioServer, wrapStdio, type StdioServerTransport } from "./stdio.js";
import { registerStdioProcessLifecycle } from "./stdio-lifecycle.js";
import { createStdioServices } from "./stdioServices.js";
import { ensureRemoteServerDeviceMid } from "./stdioDeviceMid.js";
import {
  materializeBundledZCodeBuiltinProviderConfig,
  readBundledZCodeBuiltinProviderConfig,
} from "./bundledZCodeBuiltinProviderConfig.js";

// In stdio mode, all logging goes to stderr
const log = (...args: unknown[]) =>
  console.error(formatLogPrefix("zcode-server:stdio", process.pid), ...args);
const stderrConsoleLog = (...args: unknown[]) => console.error(...args);

// stdio 模式下 stdout 只能承载 RPC 帧。
// 之前 services 里的 info/debug 日志仍会走 console.log / console.info，
// 一旦把普通文本写进 stdout，就会直接污染协议流，表现成远程调用一直 pending / loading。
// 这里在 entry 层统一把普通 console 输出重定向到 stderr，确保所有服务日志都不会再打坏 RPC。
console.log = stderrConsoleLog;
console.info = stderrConsoleLog;
console.warn = stderrConsoleLog;
console.debug = stderrConsoleLog;

// --version flag: print version and exit (used by deploy version check)
if (process.argv.includes("--version")) {
  process.stdout.write(ZCODE_VERSION + "\n");
  process.exit(0);
}

async function main() {
  // Phase 1: Send hello message
  const hello: HelloMessage = {
    type: "zcode-hello",
    version: ZCODE_VERSION,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
  };
  process.stdout.write(JSON.stringify(hello) + "\n");

  // Phase 2: Wait for hello-ack
  const ack = await waitForAck();
  log(`client connected: ${ack.clientId} (v${ack.version})`);

  // 远端主机没有 Desktop main，没人写 telemetry-state.json，services 发往 ZCode endpoint
  // 的请求缺 X-Device-Mid，Start Plan 的 billing/balance 被拒。远端 server 是本机设备身份的
  // 生命周期所有者，必须在 services 创建前确保 deviceMid 存在（详见 stdioDeviceMid.ts）。
  await ensureRemoteServerDeviceMid({ log });

  // Phase C Alpha 3：transport 所有权上移到 entry。同一 stdio protocol 上除了既有的
  // ChannelServer（向桌面暴露服务）外，再挂一个反向 ChannelClient——桌面窗口 Host 会在
  // 它那一侧的同一 protocol 上构造 desktop-serving ChannelServer（构造即回 Initialize），
  // 远端经窄化 bot-share-file-forward channel 把 bots/shareFile 裁决 forward 回桌面单一
  // 写出核心。RequestType/ResponseType 数值域不相交，两个方向共享同一条 stdio 流互不干扰；
  // 旧桌面不回 Initialize 时 forward 按 unsupported-method 折叠（见 createStdioServices）。
  const stdioSocket = wrapStdio();
  const stdioProtocol = new SocketProtocol(stdioSocket);
  const desktopChannelClient = new ChannelClient(stdioProtocol);
  const stdioTransport: StdioServerTransport = {
    socket: stdioSocket,
    protocol: stdioProtocol,
  };

  // Phase 3: Initialize services and start stdio RPC server
  const zcodeBuiltinProviderConfigFilePath = await materializeBundledZCodeBuiltinProviderConfig({
    environmentConfigRoot: getAppConfigDir(),
    content: readBundledZCodeBuiltinProviderConfig(),
  });
  const { authorityModeParseResult, services } = createStdioServices({
    env: process.env,
    zcodeBuiltinProviderConfigFilePath,
    desktopChannelClient,
  });
  // Alpha 4 诊断足迹：装配时刻的 authority 裁决 + 反向 forwarder 是否注入，一行钉住
  // 「desktop-attached-remote 却没有 forwarder」（Chain X-a 的装配前提）与
  // 「根本不是远程装配」两种静默错配。经 stderr 中继为桌面侧 "[remote]" 日志。
  log(
    `bot share file forward: authority=${authorityModeParseResult.mode} forwarder=${desktopChannelClient ? "ready" : "absent(client=absent)"}`,
  );
  if (authorityModeParseResult.invalidRawValue) {
    log(
      `${SERVICE_AUTHORITY_MODE_ENV}=${authorityModeParseResult.invalidRawValue} 非法，按默认本机 Environment 权威模式启动`,
    );
  }
  const stdioServer = createStdioServer(services, { transport: stdioTransport });
  registerStdioProcessLifecycle({
    stdin: process.stdin,
    signalSource: process,
    log,
    stopRpc: () => stdioServer.stop(),
    // Desktop Host 已经会等待 disposeServiceResourcesAndWait，远端 stdio
    // entry 却仍直接 process.exit，导致其托管的 workspace Agent 来不及完成进程树清理。
    // 远端 server 也是 ServiceCollection owner，退出前必须遵守同一异步回收契约。
    dispose: () => disposeServiceResourcesAndWait(services),
    exit: (code) => process.exit(code),
  });
  // ready 日志必须在退出监听注册之后；否则 SSH 恰好在 ready 后断开时，
  // SIGHUP/SIGTERM 仍可能落入 Node 默认处理并绕过 Agent cleanup。
  log("stdio mode ready");
}

function waitForAck(): Promise<HelloAckMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Handshake timeout: no hello-ack received within 10s"));
    }, 10_000);

    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        // Remove listener — remaining data in buffer will be consumed by RPC
        process.stdin.removeListener("data", onData);
        clearTimeout(timeout);

        try {
          const rawValue = JSON.parse(line);
          const result = helloAckMessageSchema.safeParse(rawValue);
          if (!result.success) {
            reject(new Error(`Invalid hello-ack: ${formatZodError(result.error)}`));
            return;
          }
          const msg = result.data as HelloAckMessage;
          // If there's remaining data after the newline, push it back
          const remaining = buffer.slice(newlineIdx + 1);
          if (remaining.length > 0) {
            process.stdin.unshift(Buffer.from(remaining, "utf-8"));
          }
          resolve(msg);
        } catch (err) {
          reject(new Error(`Failed to parse hello-ack: ${err}`));
        }
      }
    };

    process.stdin.on("data", onData);
  });
}

main().catch((err) => {
  log("fatal:", err);
  process.exit(1);
});
