// 常驻 cron scheduler 进程入口：由 desktop main 通过 electronUtilityProcess.fork 拉起。
// 逻辑与端口注入 seam 在 schedulerRuntime.ts；本文件只做 process.parentPort 装配，
// 使 node:test 可以脱离 Electron 直接驱动 runtime（见 desktop/test/schedulerRuntime.test.ts）。
import { AutomationRepo, OffPeakTaskRepo } from "@zcode/services/node";
import { createSchedulerRuntime, type SchedulerPort } from "./schedulerRuntime.js";

const { parentPort } = process;

/** 父端口缺省（非 utilityProcess 调试运行）时退化为控制台端口，保持可观测。 */
const electronPort: SchedulerPort | null = parentPort
  ? {
      postMessage: (message) => parentPort.postMessage(message),
      onMessage: (listener) => {
        parentPort.on("message", (event: Electron.MessageEvent) => listener(event.data));
      },
    }
  : null;

if (electronPort) {
  createSchedulerRuntime({
    port: electronPort,
    automationRepo: new AutomationRepo(),
    offPeakRepo: new OffPeakTaskRepo(),
  });
} else {
  // eslint-disable-next-line no-console -- scheduler 调试兜底
  console.error("[scheduler] no parentPort; scheduler must run as utilityProcess");
  process.exit(1);
}
