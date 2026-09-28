export interface DefaultPluginMarketplace {
  id: string;
  /**
   * 网络源字符串；官方市场 bundled-only（P5 D-P5.3a：随应用内置分发，无网络 manifest），
   * 因此该字段可缺省。缺省时 adapter 侧落盘为 `{ source: "bundled" }` 且永不网络刷新。
   */
  source?: string;
  name: string;
  description: string;
  pluginCount: number;
  lastUpdated?: string;
}

export const ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID = "zcode-plugins-official";

/** 自由市场（D-P5.3a）：first-party 网络目录，预注册为第二个默认市场，不可经 UI 移除。 */
const ZCODE_LIBRE_PLUGIN_MARKETPLACE_ID = "zcode-plugins-libre";

/**
 * Settings 三类资源发现共用；Bootstrap 单测与官方 definition 的 defaultEnabled 机械对照。
 * P5 收敛：幻影官方插件定义（documents/pdf/presentations/spreadsheets、plugin-creator、
 * skill-creator、zcode-guide、image-search 等）随市场去供应商化删除后，默认启用名单
 * 只剩 in-tree 的 browser-use 与 node-repl-host（宿主），与 bootstrap 侧
 * official-plugin-definitions.ts 的 defaultEnabled 派生集合逐一对应（见
 * packages/shared/test/pluginMarketplacesP5.test.ts 的 parity 校验）。
 */
export const DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "browser-use@zcode-plugins-official",
  // node_repl 宿主：不进市场、不对用户露出，也不贡献任何 skill/command/subagent，但必须
  // 始终可用 —— node_repl 的注册门禁是「Browser Use 或 Computer Use 任一启用」，宿主自己
  // 不参与那个判断。Browser Use 默认开着，宿主若默认关就等于它上来就没有宿主。
  "node-repl-host@zcode-plugins-official",
]);

export const DEFAULT_PLUGIN_MARKETPLACES: DefaultPluginMarketplace[] = [
  {
    // ZCode 官方市场（P5 起 bundled-only）：目录完全由应用内置 seed 分片构成，无网络 source，
    // 不做网络刷新。P6：known_marketplaces.json 里遗留的旧 source 记录在加载边界整体丢弃
    //（见 isAllowedPersistedMarketplaceSource），官方市场由默认注册机制重播种为 bundled。
    id: ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    name: ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    description: "Official ZCode plugins marketplace: built-in plugins bundled with the app.",
    pluginCount: 0,
  },
  {
    // 自由市场：github.com/yeyuan98/zcode-plugins 的 marketplace.json（raw.githubusercontent），
    // 插件 zip 为带 sha256 的 GitHub Release 资产。预注册为默认市场但零默认启用插件，
    // 安装永远是用户显式动作；首次打开商店时由 10 分钟节流的自动刷新物化目录。
    id: ZCODE_LIBRE_PLUGIN_MARKETPLACE_ID,
    source: "https://raw.githubusercontent.com/yeyuan98/zcode-plugins/main/marketplace.json",
    name: ZCODE_LIBRE_PLUGIN_MARKETPLACE_ID,
    description: "Libre plugin marketplace hosted in the yeyuan98/zcode-plugins repository.",
    pluginCount: 0,
  },
];

// 商店「公开」分段 = 官方 + 自由两个预注册市场；其余市场一律归入「个人」分段。
export const PUBLIC_STORE_MARKETPLACE_IDS = [
  ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
  ZCODE_LIBRE_PLUGIN_MARKETPLACE_ID,
] as const;

export function isPublicStoreMarketplaceId(id: string): boolean {
  return (PUBLIC_STORE_MARKETPLACE_IDS as readonly string[]).includes(id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * P6（specs/distribution-and-updates.md P6 修订）：known_marketplaces 落盘记录的
 * source 形状校验。P5 及之前的宽松守卫（isRecord(source) 即通过）随“遗留结构
 * 一律删除”裁决收紧：未知判别式或缺必需字段的旧记录在加载边界整份丢弃。
 */
export function isValidPersistedMarketplaceSource(source: unknown): boolean {
  if (!isRecord(source)) return false;
  switch (source.source) {
    case "url":
      return typeof source.url === "string" && source.url.length > 0;
    case "github":
      return typeof source.repo === "string" && source.repo.length > 0;
    case "git":
      return typeof source.url === "string" && source.url.length > 0;
    case "npm":
      return typeof source.package === "string" && source.package.length > 0;
    case "file":
    case "directory":
      return typeof source.path === "string" && source.path.length > 0;
    case "hostPattern":
      return typeof source.hostPattern === "string" && source.hostPattern.length > 0;
    case "pathPattern":
      return typeof source.pathPattern === "string" && source.pathPattern.length > 0;
    case "settings":
      return (
        isRecord(source.marketplace) &&
        typeof source.marketplace.name === "string" &&
        Array.isArray(source.marketplace.plugins)
      );
    case "bundled":
      return true;
    default:
      return false;
  }
}

/**
 * P6 保留 id 的磁盘 source 契约：保留 id（即默认市场 id）的记录只接受与其默认
 * 定义一致的 source —— 无网络源默认（官方）只认 bundled；带 url 默认（libre）
 * 只认默认 raw catalog url。携带其他 source 的保留 id 记录（历史供应商 CDN url、
 * 外部仓库冒名等）在加载边界丢弃，由默认注册机制按需重播种。非保留 id（个人
 * 市场）接受一切合法形状（I8：个人源全保留）。
 */
export function isAllowedPersistedMarketplaceSource(id: string, source: unknown): boolean {
  if (!isValidPersistedMarketplaceSource(source)) return false;
  const definition = DEFAULT_PLUGIN_MARKETPLACES.find((marketplace) => marketplace.id === id);
  if (!definition) return true;
  if (!definition.source) return isRecord(source) && source.source === "bundled";
  return isRecord(source) && source.source === "url" && source.url === definition.source;
}
