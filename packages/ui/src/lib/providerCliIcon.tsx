import type { ZCodeProvider } from "@zcode/shared";
import { ZcodeMonochromeIcon } from "@/components/ui/ZcodeMonochromeIcon.js";

export function renderProviderCliIcon(_provider: ZCodeProvider = "zcode", className?: string) {
  // 仅剩 zcode provider；保留原始 logo 轮廓，只做灰白化处理。
  // 之前的线框化虽然更“纯黑白”，但品牌辨识度下降太明显；
  // 改成统一滤镜后，页面里仍然是原 logo，同时颜色更克制。
  return <ZcodeMonochromeIcon className={className} />;
}
