// D7（specs/rebrand-and-final-release.md）：electron-updater 的 updaterCacheDirName 默认由
// package name（@zcode/desktop）派生，会与上游 ZCode 在同一台机器共用更新缓存目录。
// afterPack 最后一步改写打包产物内的 app-update.yml，把缓存目录隔离到 Zodex 自己的 appId 下。
export const UPDATER_CACHE_DIR_NAME = "dev.zodex.app-updater";

const UPDATER_CACHE_DIR_NAME_LINE = `updaterCacheDirName: ${UPDATER_CACHE_DIR_NAME}`;

export function applyUpdaterCacheIsolation(yamlText) {
  let replaced = false;
  const lines = yamlText.split("\n").map((line) => {
    if (!/^updaterCacheDirName\s*:/.test(line)) {
      return line;
    }
    replaced = true;
    return UPDATER_CACHE_DIR_NAME_LINE;
  });
  if (replaced) {
    return lines.join("\n");
  }
  const separator = yamlText.endsWith("\n") ? "" : "\n";
  return `${yamlText}${separator}${UPDATER_CACHE_DIR_NAME_LINE}\n`;
}
