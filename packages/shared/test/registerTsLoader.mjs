import { register } from "node:module";

// 注册 shared 单测专用的 TS 说明符解析钩子；见 tsLoader.mjs 顶部说明。
register(new URL("./tsLoader.mjs", import.meta.url));
