import { useServices } from "@/hooks/useServices.js";
import { useOffPeakTaskStore } from "@/store/offPeakTaskStore.js";

/**
 * 闲时入口共享列表初始化（P3 本地化：无灰度/套餐/额度资格链）。
 * Registry revision 变化只作为可见性刷新信号——创建资格由 AutomationsSection
 * 直接读 provider view（存在可选模型即可创建），store 不保存资格状态。
 */
export function useOffPeakEligibility(): void {
  const { offPeakTaskService } = useServices();
  const initialize = useOffPeakTaskStore((state) => state.initialize);
  void initialize({ offPeakTaskService });
}
