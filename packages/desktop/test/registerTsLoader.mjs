import { register } from "node:module";

// desktop 单测复用 services 的 TS 说明符/包内导入解析钩子（.js→.ts 回映射 + esbuild 转换）；
// 该钩子按“仓库 TS 源文件”过滤，desktop 源码同样命中。见 services/test/tsLoader.mjs 顶部说明。
register(new URL("../../services/test/tsLoader.mjs", import.meta.url));
