/**
 * Bot 出站投递的远端 workspace 文件读取 —— 纯路径/配额策略（specs/bot-file-delivery.md
 * Phase C — Alpha 2）。
 *
 * 纪律：本文件不做任何 IO。路径语义通过注入的 `BotWorkspaceFilePathOps` 表达——
 * 远端 CLI（apps/zcode-cli）传自己的 `node:path`，即文件系统所有者的 OS 语义
 * （Linux/macOS 远端按 POSIX，Windows 远端按 win32）；测试注入任意实现即可做
 * 矩阵验证。桌面侧从不在此解析远端路径。
 *
 * 裁决顺序（全部由远端机器执行，缺一不可）：
 *   ① 绝对路径 / 词法 `..` 逃逸 → outside-workspace（本文件的纯词法判定）
 *   ② realpath(root) 与 realpath(file) 的 containment → outside-workspace
 *      （符号链接逃逸在这里暴露；由 CLI 侧 fs.realpath 提供输入）
 *   ③ stat：缺失 → not-found；整文件 > 硬上限 → too-large（对 5MB 产品上限的
 *      纵深防御，读回时再 stat 一次防 TOCTOU 增长）
 */

/** 整文件硬上限（10MB）：高于 5MB 产品上限的 defense-in-depth，wire 层与 CLI 层共用。 */
export const BOT_WORKSPACE_FILE_HARD_CAP_BYTES = 10 * 1024 * 1024;

/**
 * 最小路径操作面。等价于 `node:path` 的同名成员；注入而非 import，
 * 保证本模块无 Node 依赖、可被任意端复用与单测。
 */
export interface BotWorkspaceFilePathOps {
  isAbsolute(path: string): boolean;
  normalize(path: string): string;
  join(...paths: string[]): string;
  readonly sep: string;
}

/** 请求词法判定结果：通过则给出拼好并归一化的候选绝对路径。 */
export type BotWorkspaceFilePathDecision =
  | { ok: true; lexicalPath: string }
  | { ok: false; reason: "outside-workspace" };

/**
 * ① 词法层判定：绝对路径直接拒绝（远端 OS 语义）；相对路径 join 到 root 后
 * normalize，`..` 逃逸出 root 的拒绝。normalize 后仍在 root 内的（如
 * `sub/../file`）放行——最终 containment 由 realpath 层裁决。
 */
export function evaluateBotWorkspaceFilePath(params: {
  pathOps: BotWorkspaceFilePathOps;
  workspaceRoot: string;
  relativePath: string;
}): BotWorkspaceFilePathDecision {
  const { pathOps, workspaceRoot, relativePath } = params;
  // 绝对路径是「越权意图」而非协议错误：判 outside-workspace，让调用方得到
  // 可本地化的拒绝理由，而不是一次 schema 异常。
  if (pathOps.isAbsolute(relativePath)) {
    return { ok: false, reason: "outside-workspace" };
  }
  const root = pathOps.normalize(workspaceRoot);
  const joined = pathOps.normalize(pathOps.join(root, relativePath));
  if (joined === root || joined.startsWith(root + pathOps.sep)) {
    return { ok: true, lexicalPath: joined };
  }
  return { ok: false, reason: "outside-workspace" };
}

/**
 * ② realpath 层判定：realpath 后的文件必须落在 realpath 后的 root 里。
 * 符号链接指向 workspace 外（symlink escape）时 containment 不成立。
 */
export function isRealpathInsideWorkspace(params: {
  pathOps: BotWorkspaceFilePathOps;
  realWorkspaceRoot: string;
  realFilePath: string;
}): boolean {
  const { pathOps, realWorkspaceRoot, realFilePath } = params;
  const root = pathOps.normalize(realWorkspaceRoot);
  const file = pathOps.normalize(realFilePath);
  return file === root || file.startsWith(root + pathOps.sep);
}

/** ③ 大小硬上限判定：读前 stat 与读后再 stat（防增长）共用同一把尺子。 */
export function botWorkspaceFileSizeExceedsHardCap(sizeBytes: number): boolean {
  return sizeBytes > BOT_WORKSPACE_FILE_HARD_CAP_BYTES;
}

/**
 * fs 错误分类：缺失（ENOENT）/路径组件不是目录（ENOTDIR）/目标是目录（EISDIR，
 * Linux 上 open 目录成功、read 才报 EISDIR）归 not-found；其余（EACCES、EIO 等）
 * 对投递语义是「本次读不可完成」→ unavailable。以稳定 error.code 判定，不嗅探
 * 错误文本。
 */
export function classifyBotWorkspaceFileFsError(error: unknown): "not-found" | "unavailable" {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string" && (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR")) {
    return "not-found";
  }
  return "unavailable";
}
