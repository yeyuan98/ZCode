import { useCallback, useState } from "react";
import { useServices } from "@/hooks/useServices.js";

export type ProviderModelDiscoveryState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; addedCount: number }
  | { status: "failure"; error: string };

/**
 * 设置页“发现模型”动作的状态机（P1.1 spec §4）：先由服务端用 provider 自己的配置
 * 发现模型列表（API Key 不出服务端），再把 id + 端点 hints 批量合并进 personal 模型
 * 列表。失败仅提示，不改动任何现有模型（发现永不删除）；成功态只报告实际新增数量，
 * 与 personal/builtin 重复的 id 由服务端静默跳过。
 */
export function useDiscoverProviderModels(providerId: string) {
  const { providerSettingsService } = useServices();
  const [state, setState] = useState<ProviderModelDiscoveryState>({ status: "idle" });

  const discover = useCallback(async (): Promise<ProviderModelDiscoveryState> => {
    setState({ status: "testing" });
    let next: ProviderModelDiscoveryState;
    try {
      const result = await providerSettingsService.discoverProviderModels(providerId);
      if (!result.ok) {
        next = { status: "failure", error: result.error };
      } else {
        const models = result.modelIds.map((id) => {
          const hints = result.modelHints?.[id];
          return hints ? { id, hints } : id;
        });
        const addedCount = await providerSettingsService.addPersonalModels(providerId, models);
        next = { status: "success", addedCount };
      }
    } catch (error) {
      next = {
        status: "failure",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    setState(next);
    return next;
  }, [providerId, providerSettingsService]);

  const reset = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  return { state, discover, reset };
}
