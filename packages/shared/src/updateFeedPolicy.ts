/**
 * 更新源策略 flag（libre-zcode P0，详见 specs/telemetry-and-update-policy.md）。
 *
 * 当前更新源仍是厂商 manifest provider（zcode.z.ai 的 /api/v1/releases/electron/manifest）。
 * semver 语义上 3.14.3 > 3.14.3-alpha.N，厂商源会把每个 alpha 构建判定为"可升级"，
 * 自动迁移/强更回厂商构建，因此在切换到 GitHub provider（P5）之前，三条更新路径
 * （启动轮询、手动检查、强制升级 gate）全部禁用。
 *
 * P5 换 GitHub provider 后删除本 flag 并恢复更新路径。
 */
export function isVendorManifestUpdateFeedWired(): boolean {
  return true;
}
