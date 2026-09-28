import type { ZCodeProvider } from "@zcode/shared";

export const ZCODE_MODE_OPTION_LABEL_IDS: Record<ZCodeProvider, Record<string, string>> = {
  zcode: {
    build: "mode.label.zcode.build",
    edit: "mode.label.zcode.edit",
    plan: "mode.label.zcode.plan",
    yolo: "mode.label.zcode.yolo",
  },
};

export const ZCODE_MODE_OPTION_DESCRIPTION_IDS: Record<ZCodeProvider, Record<string, string>> = {
  zcode: {
    build: "mode.description.zcode.build",
    edit: "mode.description.zcode.edit",
    plan: "mode.description.zcode.plan",
    yolo: "mode.description.zcode.yolo",
  },
};
