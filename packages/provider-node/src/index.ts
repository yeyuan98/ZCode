// P3 C5 供应商目录远端下载删除：zcode-builtin-download / zcode-builtin-remote-synchronizer /
// endpoint-scoped-zcode-builtin-source / zcode-builtin-cache-paths 四个模块已移除
// （client/configs → builtin_provider_config_json → CDN 链路整体下线）。
// Registry 只读打包/本地 zcode-builtin.json，离线可用。
export * from "./zcode-builtin-provider-config-source.js";
export * from "./zcode-builtin-release.js";
export * from "./zcode-builtin-provider-config-materializer.js";
export * from "./model-selection-config-repository.js";
export * from "./personal-provider-config-repository.js";
export * from "./provider-config-file-codec.js";
export * from "./provider-config-runtime.js";
export * from "./provider-registry-runtime.js";
export * from "./model-selection-facade.js";
export * from "./runtime-paths.js";
