import { randomUUID } from "node:crypto";
import { Emitter, VSBuffer, SocketProtocol, ChannelServer, type ISocket } from "@zcode/rpc";
import {
  IZCodeAgentService,
  IConversationExportService,
  createZCodeAgentConnectionScope,
  scopeConversationExportServiceForConnection,
  type ServiceCollection,
} from "@zcode/services";

/**
 * Wrap process.stdin/stdout as an ISocket for RPC communication.
 * In stdio mode, stdout is reserved exclusively for RPC data.
 * All logging must go through stderr.
 */
export function wrapStdio(): ISocket {
  const onData = new Emitter<VSBuffer>();
  const onClose = new Emitter<void>();
  const onEnd = new Emitter<void>();

  process.stdin.on("data", (chunk: Buffer) => {
    onData.fire(VSBuffer.wrap(new Uint8Array(chunk)));
  });
  process.stdin.on("end", () => {
    onClose.fire();
    onEnd.fire();
  });
  process.stdin.on("error", () => {
    onClose.fire();
    onEnd.fire();
  });

  return {
    onData: onData.event,
    onClose: onClose.event,
    onEnd: onEnd.event,
    write(buffer: VSBuffer) {
      process.stdout.write(Buffer.from(buffer.buffer));
    },
    end() {
      process.stdout.end();
    },
    drain() {
      return new Promise<void>((resolve) => {
        if (process.stdout.writableNeedDrain) {
          process.stdout.once("drain", resolve);
        } else {
          resolve();
        }
      });
    },
    dispose() {
      process.stdin.destroy();
    },
  };
}

/**
 * 预构建的 stdio RPC transport。Phase C Alpha 3：entry 需要在 services 创建前就拿到
 * 同一 protocol 上的反向 ChannelClient（远端→桌面 forward），因此 socket/protocol 的
 * 所有权上移到 entry，由这里复用；缺省时维持旧行为（自建 wrapStdio）。
 */
export interface StdioServerTransport {
  socket: ISocket;
  protocol: SocketProtocol;
}

export function createStdioServer(
  services: ServiceCollection,
  options?: { transport?: StdioServerTransport },
) {
  const socket = options?.transport?.socket ?? wrapStdio();
  const protocol = options?.transport?.protocol ?? new SocketProtocol(socket);
  const channelServer = new ChannelServer(protocol, "stdio");
  const agentService = services.getOptional(IZCodeAgentService);
  const connectionScope = agentService
    ? createZCodeAgentConnectionScope(agentService, {
        connectionId: `server-stdio-${randomUUID()}`,
        clientMode: "desktop-continuous",
        role: "trusted-host-relay",
      })
    : undefined;
  services.exposeOnChannelServer(
    channelServer,
    // P5 W4b：导出服务绑定同一 stdio attachment 的 scoped Agent（rowsRange 需要
    // trusted-carrier；本地导出无网络）。
    (() => {
      const overrides = new Map<string, unknown>(
        connectionScope ? [[IZCodeAgentService.channelName, connectionScope.service]] : [],
      );
      const conversationExportService = services.getOptional(IConversationExportService);
      if (conversationExportService) {
        overrides.set(
          IConversationExportService.channelName,
          scopeConversationExportServiceForConnection(
            conversationExportService,
            connectionScope?.service,
          ),
        );
      }
      return overrides;
    })(),
  );
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (stopPromise) {
      return stopPromise;
    }

    // 先同步摘掉 protocol listener，保证从这一刻起不再接收新的 service RPC；
    // connection scope 的异步退订完成后再关闭底层 stdio。
    channelServer.dispose();
    stopPromise = (async () => {
      try {
        await connectionScope?.dispose();
      } finally {
        socket.dispose();
      }
    })();
    return stopPromise;
  };
  socket.onClose(() => {
    void stop();
  });
  return { stop };
}
