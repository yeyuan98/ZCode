import type { ImgHTMLAttributes } from "react";
import zcodeDarkIcon from "@/assets/cli-icons/icon-zcode-for-dark.png";
import zcodeLightIcon from "@/assets/cli-icons/icon-zcode-for-light.png";
import { cn } from "@/components/lib/utils.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { resolveTheme } from "@/useTheme.js";

type ZcodeMonochromeIconProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src">;

export function ZcodeMonochromeIcon({
  className,
  alt = "",
  style,
  ...props
}: ZcodeMonochromeIconProps) {
  const theme = useZCodeStore((state) => state.theme);
  const isDark = resolveTheme(theme) === "dark";
  const src = isDark ? zcodeDarkIcon : zcodeLightIcon;

  // 线框化版本会破坏原始 logo 的识别度，视觉上也偏轻。
  // 这里恢复原始位图，只做去色和明度压缩：
  // 浅色主题保留偏灰效果，深色主题抬到偏白效果，
  // 这样既能压掉自带的蓝色，又不丢原始轮廓。
  const filter = isDark
    ? "grayscale(1) brightness(1.9) contrast(0.8)"
    : "grayscale(1) brightness(0.74) contrast(1.05)";

  return (
    <img
      src={src}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      className={cn("shrink-0 object-contain", className)}
      style={{ filter, ...style }}
      {...props}
    />
  );
}
