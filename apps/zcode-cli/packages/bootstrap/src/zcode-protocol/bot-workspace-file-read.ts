// ============================================================
// v4/bot-workspace-file/read —— Bot 出站投递读取本机 workspace 文件
// (specs/bot-file-delivery.md Phase C — Alpha 2)
// ============================================================
//
// 与 attachmentRead 同一条纪律的镜像：**文件系统所有者是 containment 的唯一
// 裁决者**。desktop 从不解析远端路径；这里按本进程（远端机器）的 OS 语义完成
// 全部判定，词法/配额策略复用 @zcode/shared 的纯 helper（apps/zcode-cli 无测试
// harness，可测逻辑全部留在 shared，本文件只做 fs IO 编排）。
//
// 判定顺序（缺一不可）：
//   ① 词法：绝对路径 / `..` 逃逸 → outside-workspace（shared 纯 helper）
//   ② realpath：文件与 root 都 realpath，containment 不成立（symlink escape）
//      → outside-workspace
//   ③ 打开 + fd stat：非常规文件 → not-found；>10MB 硬上限 → too-large
//   ④ 分块读（≤512KiB，limit 由 wire schema 严格限定）
//   ⑤ 读后再 stat：增长越过硬上限 → too-large（TOCTOU 防护）
//
// 任何 fs 错误按 error.code 归类（ENOENT/ENOTDIR → not-found，其余 →
// unavailable），不嗅探错误文本。

import { open, realpath } from "node:fs/promises";
import path from "node:path";

import {
  botWorkspaceFileSizeExceedsHardCap,
  classifyBotWorkspaceFileFsError,
  evaluateBotWorkspaceFilePath,
  isRealpathInsideWorkspace,
} from "@zcode/shared";
import {
  v4BotWorkspaceFileReadParamsSchema,
  type V4BotWorkspaceFileReadResult,
} from "@zcode/shared/zcode-protocol-v4";

/** workspace root = 本 gateway 进程的 cwd（desktop 在 spawn 时以 workspace 为 cwd）。 */
const WORKSPACE_ROOT = () => process.cwd();

function rejected(
  reason: "outside-workspace" | "not-found" | "too-large" | "unavailable",
  detail?: string,
): V4BotWorkspaceFileReadResult {
  return { ok: false, reason, ...(detail !== undefined ? { detail } : {}) };
}

/** 只取稳定 error.code 字符串（诊断 detail 用），不做文本嗅探。 */
function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

export async function readBotWorkspaceFile(rawParams: unknown): Promise<V4BotWorkspaceFileReadResult> {
  const params = v4BotWorkspaceFileReadParamsSchema.parse(rawParams);
  const root = WORKSPACE_ROOT();

  // ① 词法判定：绝对路径与 `..` 逃逸在触碰 fs 之前拒绝。
  const lexical = evaluateBotWorkspaceFilePath({
    pathOps: path,
    workspaceRoot: root,
    relativePath: params.relativePath,
  });
  if (!lexical.ok) {
    return rejected("outside-workspace");
  }

  // ② realpath 层：root 与文件各自 realpath 后 containment 必须成立，
  //    symlink 指向 workspace 外即逃逸。文件缺失（ENOENT）在这里归 not-found。
  const realRoot = await realpath(root).catch((error: unknown) => {
    throw Object.assign(new Error("workspace root unavailable"), { cause: error });
  });
  let realFilePath: string;
  try {
    realFilePath = await realpath(lexical.lexicalPath);
  } catch (error) {
    return rejected(classifyBotWorkspaceFileFsError(error), errorCode(error));
  }
  if (
    !isRealpathInsideWorkspace({ pathOps: path, realWorkspaceRoot: realRoot, realFilePath })
  ) {
    return rejected("outside-workspace");
  }

  // ③④⑤ 打开 → fd stat（整文件硬上限 + 常规文件校验）→ 分块读 → 再 stat 防增长。
  let file;
  try {
    file = await open(realFilePath, "r");
  } catch (error) {
    return rejected(classifyBotWorkspaceFileFsError(error), errorCode(error));
  }
  try {
    const statBefore = await file.stat();
    if (!statBefore.isFile()) {
      // 目录/设备节点不是可投递文件：按 not-found 口径拒绝。
      return rejected("not-found");
    }
    if (botWorkspaceFileSizeExceedsHardCap(statBefore.size)) {
      return rejected("too-large");
    }
    const filename = path.basename(realFilePath);
    if (params.offset >= statBefore.size) {
      // offset 越过 EOF：空读终止（eof=true），供取回循环幂等收尾。
      return { ok: true, filename, sizeBytes: statBefore.size, dataBase64: "", eof: true };
    }
    const buffer = Buffer.alloc(params.limit);
    let totalBytes = 0;
    while (totalBytes < params.limit) {
      const { bytesRead } = await file.read(
        buffer,
        totalBytes,
        params.limit - totalBytes,
        params.offset + totalBytes,
      );
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
    }
    const statAfter = await file.stat();
    if (botWorkspaceFileSizeExceedsHardCap(statAfter.size)) {
      // stat 与 read 之间文件被写大：读回的字节可能已越过产品上限，整块拒绝。
      return rejected("too-large");
    }
    const eof = params.offset + totalBytes >= statAfter.size;
    return {
      ok: true,
      filename,
      sizeBytes: statAfter.size,
      dataBase64: buffer.subarray(0, totalBytes).toString("base64"),
      eof,
    };
  } catch (error) {
    return rejected(classifyBotWorkspaceFileFsError(error), errorCode(error));
  } finally {
    await file.close().catch(() => {
      // fd 关闭失败只影响句柄回收，不能改写已确定的读取结果。
    });
  }
}
