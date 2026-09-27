import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OFF_PEAK_WINDOW,
  msUntilWindowOpen,
  normalizeOffPeakWindow,
  withinWindow,
  type OffPeakWindowSettings,
} from "@zcode/shared";

function at(hour: number, minute = 0, second = 0, ms = 0): Date {
  const now = new Date();
  now.setHours(hour, minute, second, ms, 0);
  return now;
}

function windowOf(start: string, end: string, enabled = true): OffPeakWindowSettings {
  return { enabled, start, end };
}

test("withinWindow: disabled 恒为 true（任意时间可调度）", () => {
  for (const now of [at(0, 0), at(9, 30), at(23, 59)]) {
    assert.equal(withinWindow(now, windowOf("00:00", "00:00", false)), true);
    assert.equal(withinWindow(now, windowOf("03:00", "05:00", false)), true);
  }
});

test("withinWindow: 常规区间 [start, end)——start 含、end 不含（边界钉死）", () => {
  const window = windowOf("00:00", "07:00");
  assert.equal(withinWindow(at(0, 0), window), true, "start 分钟应包含");
  assert.equal(withinWindow(at(6, 59), window), true);
  assert.equal(withinWindow(at(7, 0), window), false, "end 分钟应排除");
  assert.equal(withinWindow(at(12, 0), window), false);
  assert.equal(withinWindow(at(23, 0), window), false);

  const day = windowOf("09:30", "17:45");
  assert.equal(withinWindow(at(9, 30), day), true);
  assert.equal(withinWindow(at(9, 29), day), false);
  assert.equal(withinWindow(at(17, 44), day), true);
  assert.equal(withinWindow(at(17, 45), day), false);
});

test("withinWindow: start > end 跨午夜回绕（now >= start || now < end）", () => {
  const night = windowOf("22:00", "07:00");
  assert.equal(withinWindow(at(22, 0), night), true, "回绕区间 start 含");
  assert.equal(withinWindow(at(23, 59), night), true);
  assert.equal(withinWindow(at(0, 0), night), true);
  assert.equal(withinWindow(at(6, 59), night), true);
  assert.equal(withinWindow(at(7, 0), night), false, "回绕区间 end 不含");
  assert.equal(withinWindow(at(12, 0), night), false, "日间不在窗口");
});

test("withinWindow: start === end 视为全天窗口（避免空集永久卡死任务）", () => {
  const allDay = windowOf("08:00", "08:00");
  assert.equal(withinWindow(at(0, 0), allDay), true);
  assert.equal(withinWindow(at(8, 0), allDay), true);
  assert.equal(withinWindow(at(23, 59), allDay), true);
});

test("withinWindow: 只做本地时钟分钟比较，非法 HH:mm 输入 fail-closed", () => {
  assert.equal(withinWindow(at(1, 0), windowOf("24:00", "07:00")), false);
  assert.equal(withinWindow(at(1, 0), windowOf("00:70", "07:00")), false);
  assert.equal(withinWindow(at(1, 0), windowOf("0:00", "07:00")), false);
  assert.equal(withinWindow(at(1, 0), windowOf("00:00", "7:00")), false);
});

test("withinWindow: DST 说明——时钟跳变自然缩短/拉长有效窗口，无日历数学", () => {
  // 回绕窗口 02:00-02:30 在 DST spring-forward 日（本地 02:00-03:00 不存在），
  // 实际可命中分钟为 0；fall-back 日（02:00-03:00 出现两次）窗口被拉长。
  // 本测试只钉住语义：求值只看 Date 的本地时钟分钟，不做任何跨日/日历换算。
  const springForwardLike = new Date(2026, 2, 8, 2, 15);
  const window = windowOf("02:00", "02:30");
  assert.equal(withinWindow(springForwardLike, window), true);
  const outOfWindow = new Date(2026, 2, 8, 2, 45);
  assert.equal(withinWindow(outOfWindow, window), false);
});

test("msUntilWindowOpen: 窗口已开/disabled 返回 0；未开返回到 start 的正距离", () => {
  assert.equal(msUntilWindowOpen(at(3, 0), windowOf("00:00", "07:00")), 0);
  assert.equal(msUntilWindowOpen(at(12, 0), windowOf("00:00", "07:00", false)), 0);
  const untilOpen = msUntilWindowOpen(at(12, 0, 0, 500), windowOf("22:00", "07:00"));
  assert.equal(untilOpen, 10 * 3600_000 - 500, "12:00 → 22:00 恰好 10 小时");
  const pastMidnight = msUntilWindowOpen(at(23, 0), windowOf("01:00", "06:00"));
  assert.equal(pastMidnight, 2 * 3600_000, "23:00 → 次日 01:00 跨午夜 2 小时");
});

test("normalizeOffPeakWindow: 合法对象透传，非法形状回退默认窗口", () => {
  assert.deepEqual(normalizeOffPeakWindow({ enabled: false, start: "22:00", end: "06:00" }), {
    enabled: false,
    start: "22:00",
    end: "06:00",
  });
  assert.deepEqual(normalizeOffPeakWindow(undefined), DEFAULT_OFF_PEAK_WINDOW);
  assert.deepEqual(normalizeOffPeakWindow({ enabled: true, start: "9:00", end: "07:00" }), {
    ...DEFAULT_OFF_PEAK_WINDOW,
  });
  assert.deepEqual(normalizeOffPeakWindow({ enabled: "yes", start: "00:00", end: "07:00" }), {
    ...DEFAULT_OFF_PEAK_WINDOW,
  });
  // 跨进程程据不允许夹带未知键（strict schema strip 之外直接拒绝）。
  assert.deepEqual(
    normalizeOffPeakWindow({ enabled: true, start: "00:00", end: "07:00", extra: 1 }),
    { ...DEFAULT_OFF_PEAK_WINDOW },
  );
});
