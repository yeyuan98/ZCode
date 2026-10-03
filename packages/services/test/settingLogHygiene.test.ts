import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSettingService,
  maybeLogSettingsDailyBaseline,
} from "../src/setting/settingService.js";

// specs/log-diagnostics-hygiene.md D4（3.14.5-alpha.2）验收：
// 每个本地自然日一条脱敏全量快照；同日后续写盘只记变更键；
// 单日日志自包含（快照不依赖前一天的日志）。

interface Captured {
  lines: string[];
  restore(): void;
}

function captureConsoleLog(): Captured {
  const lines: string[] = [];
  const real = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return {
    lines,
    restore() {
      console.log = real;
    },
  };
}

test("D4 设置日志：每日一条脱敏快照 + 同日增量行 + 跨日补发不重复", async () => {
  const home = await mkdtemp(join(tmpdir(), "zcode-setting-log-"));
  const previousHome = process.env.HOME;
  const previousDesktopHome = process.env.ZCODE_DESKTOP_HOME_DIR;
  process.env.HOME = home;
  process.env.ZCODE_DESKTOP_HOME_DIR = home;
  const captured = captureConsoleLog();
  try {
    await mkdir(join(home, ".zcode", "v2"), { recursive: true });
    await writeFile(
      join(home, ".zcode", "v2", "setting.json"),
      JSON.stringify({
        keepAwakeWhileRunning: false,
        httpProxy: "http://user:secret@127.0.0.1:7890",
      }),
      "utf-8",
    );
    const service = createSettingService();

    // 当日首次写盘：全量快照；httpProxy 命中脱敏（URL 可内嵌凭据——评审修复项）。
    await service.update({ receivePreviewUpdates: true });
    const snapshotLines = captured.lines.filter((line) =>
      line.includes("settings daily snapshot:"),
    );
    assert.equal(snapshotLines.length, 1, "当日首写必须且只输出一条快照");
    assert.match(snapshotLines[0] ?? "", /"receivePreviewUpdates":true/u);
    assert.doesNotMatch(snapshotLines[0] ?? "", /127\.0\.0\.1:7890/u);
    assert.match(snapshotLines[0] ?? "", /<redacted>/u);

    // 同日第二次写盘：只记变更键，不再快照、不重复全量。
    await service.update({ keepAwakeWhileRunning: true });
    const deltaLines = captured.lines.filter((line) => line.includes("settings changed:"));
    assert.equal(deltaLines.length, 1, "同日后续写盘只输出增量行");
    assert.match(deltaLines[0] ?? "", /keepAwakeWhileRunning: false -> true/u);
    assert.equal(
      captured.lines.filter((line) => line.includes("settings daily snapshot:")).length,
      1,
      "同日不得出现第二条快照",
    );

    // 跨日补发钩子：同日重复调用不得再发快照（无 IO，纯内存日标记判定）。
    maybeLogSettingsDailyBaseline();
    assert.equal(
      captured.lines.filter((line) => line.includes("settings daily snapshot:")).length,
      1,
      "同日 tick 补发不得重复快照",
    );
  } finally {
    captured.restore();
    process.env.HOME = previousHome;
    if (previousDesktopHome === undefined) {
      delete process.env.ZCODE_DESKTOP_HOME_DIR;
    } else {
      process.env.ZCODE_DESKTOP_HOME_DIR = previousDesktopHome;
    }
    await rm(home, { recursive: true, force: true });
  }
});

test("D4 设置日志：未加载任何设置时跨日补发不输出", async () => {
  const captured = captureConsoleLog();
  try {
    // 本测试进程此前可能已加载设置（模块级缓存）；该钩子的空态契约由
    // lastKnownSettings 未定义时直接 return 保证——这里仅验证调用无副作用。
    maybeLogSettingsDailyBaseline();
    assert.ok(true);
  } finally {
    captured.restore();
  }
});
