import { useCallback, useState } from "react";
import type { DiscoveryModelHints } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";

type TemplateModelDiscoveryState =
  | { status: "idle" }
  | { status: "testing" }
  | {
      status: "success";
      modelIds: readonly string[];
      /** 按 id 附带的端点能力提示；端点不提供元数据时缺省（随保存传给 initialModels）。 */
      modelHints?: Readonly<Record<string, DiscoveryModelHints>>;
    }
  | { status: "failure"; error: string };

/**
 * 向导“测试并发现”按钮的状态机：services 层直接 HTTP 发现（不启动 agent），
 * 失败仅作提示、不阻塞保存；成功态保留模型 id + 可选 hints 供保存时随 initialModels 持久化。
 */
export function useDiscoverTemplateModels() {
  const { providerSettingsService } = useServices();
  const [state, setState] = useState<TemplateModelDiscoveryState>({ status: "idle" });

  const discover = useCallback(
    async (templateId: string, apiKey: string) => {
      setState({ status: "testing" });
      try {
        const result = await providerSettingsService.discoverTemplateModels({
          templateId,
          ...(apiKey ? { apiKey } : {}),
        });
        setState(
          result.ok
            ? {
                status: "success",
                modelIds: result.modelIds,
                ...(result.modelHints ? { modelHints: result.modelHints } : {}),
              }
            : { status: "failure", error: result.error },
        );
      } catch (error) {
        setState({
          status: "failure",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [providerSettingsService],
  );

  const reset = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  return { state, discover, reset };
}
