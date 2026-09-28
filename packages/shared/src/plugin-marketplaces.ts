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
    // 不做网络刷新；旧安装 known_marketplaces.json 里遗留的 vendor CDN source 由 adapter 侧
    // 守卫拒绝刷新（官方 id 一律不网络刷新）。
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
