import { z } from "zod";

// ---- 闲时任务本地准入窗口（P3 本地化改造）----
// 准入唯一判据：每日本地时钟窗口。服务端票据/灰度/套餐资格已删除，
// 窗口求值属于 desktop main（唯一 settings 属主），纯函数放 shared 便于两侧与测试复用。

/** "HH:mm"（本地时钟，24 小时制）。 */
export function parseOffPeakWindowMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

const offPeakWindowTimeSchema = z
  .string()
  .refine((value) => parseOffPeakWindowMinutes(value) !== null, {
    message: "expected HH:mm local-clock time",
  });

export interface OffPeakWindowSettings {
  /** false = 任意时间都可调度（用户显式选择关闭窗口）。 */
  enabled: boolean;
  start: string;
  end: string;
}

export const DEFAULT_OFF_PEAK_WINDOW: OffPeakWindowSettings = {
  enabled: true,
  start: "00:00",
  end: "07:00",
};

/** zod 对象 schema：settings 加载宽松解析，字段形状错误整体回退默认值即可。 */
export const offPeakWindowSchema = z
  .object({
    enabled: z.boolean(),
    start: offPeakWindowTimeSchema,
    end: offPeakWindowTimeSchema,
  })
  .strict();

/**
 * 纯窗口求值：now 是否落在窗口内。
 *
 * 语义钉死（测试同口径）：
 * - enabled=false 恒 true（任意时间）。
 * - start === end 视为全天窗口（避免空集把任务永久卡死）。
 * - start < end：常规区间 [start, end)——start 含、end 不含。
 * - start > end：跨午夜回绕，now >= start || now < end。
 * - 只做本地时钟分钟级比较，不做任何日历/DST 数学；夏令时跳变自然缩短/拉长有效窗口。
 */
export function withinWindow(now: Date, window: OffPeakWindowSettings): boolean {
  if (!window.enabled) return true;
  const start = parseOffPeakWindowMinutes(window.start);
  const end = parseOffPeakWindowMinutes(window.end);
  if (start === null || end === null) return false;
  if (start === end) return true;
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  return start < end
    ? minuteOfDay >= start && minuteOfDay < end
    : minuteOfDay >= start || minuteOfDay < end;
}

/**
 * 距下一次窗口打开的毫秒数（enabled=false 或已 opening 时为 0）。
 * main 用它布置 window-open 唤醒定时器；结果只依赖本地时钟分钟粒度。
 */
export function msUntilWindowOpen(now: Date, window: OffPeakWindowSettings): number {
  if (!window.enabled) return 0;
  if (withinWindow(now, window)) return 0;
  const start = parseOffPeakWindowMinutes(window.start);
  if (start === null) return 0;
  const secondOfDay = (now.getHours() * 60 + now.getMinutes()) * 60 + now.getSeconds();
  const startSecond = start * 60;
  const openInSeconds =
    startSecond > secondOfDay ? startSecond - secondOfDay : startSecond + 86_400 - secondOfDay;
  return openInSeconds * 1000 - now.getMilliseconds();
}

/** 跨进程序据只传普通对象；形状不合法时回退默认窗口（fail-open 到默认档而非崩溃）。 */
export function normalizeOffPeakWindow(value: unknown): OffPeakWindowSettings {
  const parsed = offPeakWindowSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_OFF_PEAK_WINDOW;
}
