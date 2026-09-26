import type { IPlatformService } from "@zcode/shared";
import type { IntlInstance } from "@/i18n/IntlProvider.js";
import { runExportLogsAction } from "@/lib/exportLogsAction.js";
import { ZCODE_PRODUCT_DOCS_URL } from "@/lib/productDocs.js";

interface HelpMenuActionHandlers {
  openIssueReport: () => Promise<void>;
  openProductDocs: () => void;
  exportLogs: () => void;
}

export function createHelpMenuActionHandlers({
  platform,
  intl,
}: {
  platform: Pick<
    IPlatformService,
    "captureWindowScreenshot" | "exportLogs" | "openExternal" | "openFeedback"
  >;
  intl: IntlInstance;
}): HelpMenuActionHandlers {
  return {
    // P2：问题上报改为外部 GitHub Issues；入口本身无错误现场，只带一个简短的 bug 前缀标题，
    // 详细复现步骤由用户在 new-issue 页补充。
    openIssueReport: async () => {
      await platform.openFeedback({
        title: intl.formatMessage({ id: "workspaceHeader.help.issueReport.draftTitle" }),
      });
    },
    openProductDocs: () => {
      platform.openExternal(ZCODE_PRODUCT_DOCS_URL);
    },
    exportLogs: () => {
      void runExportLogsAction(platform, intl);
    },
  };
}
