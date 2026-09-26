import { createUuid } from "@zcode/shared";

let cachedDeviceMid: string | null = null;

/**
 * 进程内临时设备 ID（P0 遥测清理后不再持久化）。
 *
 * 历史实现读写 `~/.zcode/v2/telemetry-state.json`，把持久化 device_mid 供
 * ARMS/数仓上报与厂商更新/反馈/灰度请求使用。厂商遥测删除后，本函数只返回
 * 进程内一次性 UUID，仅作为 renderer `platform.getDeviceId()` 的数据源，供
 * 本地 onboarding 记录（onboarding-record.json，文件内已有 deviceMid 为权威，
 * 每次启动的新随机值只影响文件创建那一次）等本地功能使用。
 *
 * 约束：任何厂商端点（zcode.z.ai 等）不得再收到该值；也不再读写
 * telemetry-state.json。onboarding 重构（P2）后本模块可整体删除。
 */
export function ensureDesktopDeviceMidSync(): string {
  cachedDeviceMid ??= createUuid();
  return cachedDeviceMid;
}
