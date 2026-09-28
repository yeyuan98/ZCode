/**
 * pluginMarketplacesP5.test.ts 专用的模块解析钩子。
 *
 * parity 用例需要真实加载 bootstrap 侧的 official-plugin-definitions.ts，而该文件经
 * `@zcode/contracts` barrel 传递加载含 TypeScript 参数属性（parameter property）的模块，
 * node --test 的 strip-only 模式无法解析（同 zcodeProtocolP4Purge.test.ts 头注释的既有
 * 约束）。official-plugin-definitions.ts 在运行期只消费 contracts 的官方市场 id 常量，
 * 因此这里把 `@zcode/contracts` 短路为仅含该常量的 data: 桩模块，其余说明符原样放行，
 * 让定义文件可以在不引入整个 contracts barrel 的情况下被真实求值。
 */
export async function resolve(specifier, context, next) {
  if (specifier === "@zcode/contracts") {
    return {
      shortCircuit: true,
      format: "module",
      url: `data:text/javascript,export const ZCODE_OFFICIAL_PLUGIN_MARKETPLACE = ${JSON.stringify(
        "zcode-plugins-official",
      )};`,
    };
  }
  return next(specifier, context);
}
