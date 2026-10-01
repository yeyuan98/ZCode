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

  // 全装彩排 E2E（packages/server/test/botShareFileRemoteBundleE2E.test.ts）复现的
  // 生产竞态，Chain Y 的真正根因：waitForAck 消费完 ack 行后会移除 stdin 上唯一的
  // data 监听，而 stdin 仍处于 flowing 模式——此后到 wrapStdio() 挂上持久监听之间，
  // 桌面侧写入的任何字节（尤其是 desktop-serving ChannelServer 构造即发的 Initialize
  // 帧）都会被静默丢弃。远端反向 ChannelClient 由此永远 Uninitialized，share_file
  // 恒折叠 unsupported-method（detail "desktop reverse channel never initialized"）。
  // 修复（评审轮实证补全，两个丢帧窗口都要关）：
  //  ① 分离块窗口：ack 与 Initialize 分属两个 data 块——把 socket/protocol/反向
  //     client 的构造提到任何 post-ack await 之前（await 续体与后续同步代码同处一条
  //     微任务链，期间不会插入新 I/O 事件）；
  //  ② 合并块窗口：SSH 会把同一 tick 背靠背的 ack+Initialize 合并成一个 data 块——
  //     waitForAck 对 remainder 的 unshift 发生在「flowing + 无监听 + 缓冲为空」状态，
  //     Node 走 direct-emit 路径在续体挂监听前就把字节丢掉（Node 22/24 实测复现）。
  //     因此 waitForAck 在 removeListener 之后、unshift 之前先 pause()，把流停住，
  //     unshift 的字节安全落回内部缓冲；本处在监听挂好（SocketProtocol 构造完成）之后
  //     再 resume()，显式 pause 后 on('data') 不会自动恢复流动，必须手动 resume。
  const stdioSocket = wrapStdio();
  const stdioProtocol = new SocketProtocol(stdioSocket);
  const desktopChannelClient = new ChannelClient(stdioProtocol);
  process.stdin.resume();
  const stdioTransport: StdioServerTransport = {
    socket: stdioSocket,
    protocol: stdioProtocol,
  };

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
  // （socket/protocol/client 已在 waitForAck 之后、任何异步初始化之前构造，见上方竞态注释。）

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
  // Alpha 4 诊断足迹：装配时刻的 authority 裁决 + 反向 forwarder 状态，一行钉住
  // 「根本不是远程装配」这类静默错配（经 stderr 中继为桌面侧 "[remote]" 日志）。
  // 本 entry 的 client 恒构造、forwarder 恒注入，故只打印 ready；「remote 装配却无
  // forwarder」的组合在此入口不可达，由 authority= 值单独承载判别信号。
  log(`bot share file forward: authority=${authorityModeParseResult.mode} forwarder=ready`);
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

    // 评审修复（合并块二段 Bug，E2E 合包腿实测复现）：原实现把 stdin 累积成 UTF-8
    // 字符串再对 remainder 重新编码回 Buffer——RPC 帧是二进制（长度前缀 + 任意字节），
    // 无效 UTF-8 序列会被替换字符污染，合包时 remainder 恰是首个 RPC 帧，反序列化
    // 直接崩溃（ChannelClient.onBuffer header undefined）。改为纯 Buffer 扫描：按
    // 0x0A 字节定位行尾，行文本仅对 ack 行本身做 UTF-8 解码（JSON，安全），remainder
    // 以原始字节 unshift，绝不经过字符串往返。
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const newlineIdx = buffered.indexOf(0x0a);
      if (newlineIdx === -1) {
        return;
      }
      const line = buffered.subarray(0, newlineIdx).toString("utf8").trim();
      // Remove listener — remaining data in buffer will be consumed by RPC.
      // 评审修复（合并块丢帧窗口）：先 pause 再 unshift——flowing 态 + 无监听 +
      // 缓冲为空时 unshift 走 direct-emit，字节会在 main() 续体挂好监听前被丢弃；
      // pause 后字节安全进入内部缓冲，由 main() 在监听就绪后 resume 恢复流动。
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
      clearTimeout(timeout);

      try {
        const rawValue = JSON.parse(line);
        const result = helloAckMessageSchema.safeParse(rawValue);
        if (!result.success) {
          reject(new Error(`Invalid hello-ack: ${formatZodError(result.error)}`));
          return;
        }
        const msg = result.data as HelloAckMessage;
        // If there's remaining data after the newline, push it back AS RAW BYTES.
        const remaining = buffered.subarray(newlineIdx + 1);
        if (remaining.length > 0) {
          process.stdin.unshift(remaining);
        }
        resolve(msg);
      } catch (err) {
        reject(new Error(`Failed to parse hello-ack: ${err}`));
      }
    };

    process.stdin.on("data", onData);
  });
}

main().catch((err) => {
  log("fatal:", err);
  process.exit(1);
});
