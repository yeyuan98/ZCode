import {
  DISABLED_RENDERER_ACTION_TRACE_CONFIG,
  type RendererActionTraceConfigV1,
} from "@zcode/shared";

// P3 C5 供应商 client/configs 拉取删除：rendererActionTrace 灰度不再有远端 rollout
// （原与 desktopContextPromptRollout 共用同一个 /api/v1/client/configs fetcher），
// 快照固定为本地禁用默认（DISABLED_RENDERER_ACTION_TRACE_CONFIG，fail-closed）。
// 本地诊断链路保留：ZCODE_RENDERER_ACTION_TRACE_ENABLED / ZCODE_LOCAL_TTFT_ENABLED
// 环境覆盖与 OTLP exporter（rendererActionTraceIpc / rendererActionTraceExporter）不受影响。
export interface RendererActionTraceRollout {
  refresh(): Promise<RendererActionTraceConfigV1>;
  getSnapshot(): RendererActionTraceConfigV1;
}

export function createRendererActionTraceRollout(): RendererActionTraceRollout {
  return {
    refresh: () => Promise.resolve(DISABLED_RENDERER_ACTION_TRACE_CONFIG),
    getSnapshot: () => DISABLED_RENDERER_ACTION_TRACE_CONFIG,
  };
}
