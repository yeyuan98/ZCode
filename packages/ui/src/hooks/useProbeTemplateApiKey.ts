import { useCallback, useState } from "react";
import { useServices } from "@/hooks/useServices.js";

type TemplateApiKeyProbeState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; modelCount: number }
  | { status: "failure"; error: string };

/**
 * 向导“测试 Key”按钮的探测状态机：直接 HTTP 探测（services 层），失败仅作提示、不阻塞保存。
 */
export function useProbeTemplateApiKey() {
  const { providerSettingsService } = useServices();
  const [state, setState] = useState<TemplateApiKeyProbeState>({ status: "idle" });

  const probe = useCallback(
    async (templateId: string, apiKey: string) => {
      setState({ status: "testing" });
      try {
        const result = await providerSettingsService.probeTemplateApiKey({
          templateId,
          apiKey,
        });
        setState(
          result.ok
            ? { status: "success", modelCount: result.modelCount }
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

  return { state, probe, reset };
}
