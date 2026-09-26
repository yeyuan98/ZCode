import { useEffect, useRef } from "react";
import type { IServiceAccessor } from "@zcode/services";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { toast, dismissToast } from "@/components/ui/toast.js";
import {
  createAccountConnectionRefreshObserver,
  type AccountConnectionLoss,
} from "@/root/accountConnectionRefreshObserver.js";
import { logger } from "@/logger.js";

/** 根层只观察一次；页面/文案变化不重新建立账号基线。 */
export function useAccountConnectionLossNotification(
  services: IServiceAccessor,
  intentKey: string,
) {
  const { intl } = useZCodeIntl();
  const latest = useRef({ intl });
  latest.current = { intl };
  const observerRef = useRef<ReturnType<typeof createAccountConnectionRefreshObserver> | null>(
    null,
  );
  const noticeRef = useRef<{ id: number; event: AccountConnectionLoss } | null>(null);
  useEffect(() => {
    // 设置/登录意图先于 Account 查询回包变化；即使切走又切回，旧提示也不能重新弹出。
    observerRef.current?.invalidate();
    if (noticeRef.current) dismissToast(noticeRef.current.id);
    noticeRef.current = null;
  }, [intentKey]);
  useEffect(() => {
    const observer = createAccountConnectionRefreshObserver((event) => {
      if (!event.isCurrent()) return;
      const { intl: copy } = latest.current;
      // P1：连接选择字段（providerFamilyConnectionSelections）已删除，无法再计算替代套餐建议，
      // 只保留连接不可用的纯提示（P3 重建切换建议）。
      const id = toast(
        copy.formatMessage({ id: "settings.modelProvider.connectionUnavailableNotice" }),
        {
          variant: "info",
          durationMs: 12000,
        },
      );
      noticeRef.current = { id, event };
    });
    observerRef.current = observer;
    const accept = (view: Parameters<typeof observer.accept>[0]) => {
      void observer.accept(view);
      const notice = noticeRef.current;
      if (notice && !notice.event.isCurrent()) {
        dismissToast(notice.id);
        noticeRef.current = null;
      }
    };
    const subscription = services.providerSettingsService.onDidChange(accept);
    void services.providerSettingsService
      .getView()
      .then(accept)
      .catch((error) => {
        logger.lifecycle.warn("[AccountConnection] 初次读取失败，等待正常刷新", { error });
      });
    return () => {
      observer.dispose();
      observerRef.current = null;
      subscription.dispose();
      if (noticeRef.current) dismissToast(noticeRef.current.id);
      noticeRef.current = null;
    };
  }, [services]);
}
