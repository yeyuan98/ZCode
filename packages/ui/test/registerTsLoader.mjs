import { register } from "node:module";

// 注册 UI 单测专用的 TS 说明符/别名解析钩子；见 tsLoader.mjs 顶部说明。
register(new URL("./tsLoader.mjs", import.meta.url));
