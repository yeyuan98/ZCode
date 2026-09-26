import { randomUUID } from "node:crypto";
import { chmod, lstat, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { importSubagentStateSelections } from "../subagent-state-migration.js";
import { withFileLock } from "./privateFilePersistence.js";

// 用户 Markdown 的旧 Provider 改写迁移已随 GLM 历史 hard-cut 删除；本文件只剩 agents-state.json 的格式导入。

/** 共享原子导入边界：JSON 的旧字段只在这里解释，完成落盘后 reader 只读当前字段。 */
export async function migrateSubagentStateFile(path: string): Promise<void> {
  try {
    await migrateFile(path, (original) => {
      const parsed: unknown = JSON.parse(original);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return original;
      const next = importSubagentStateSelections(parsed as Record<string, unknown>);
      return JSON.stringify(next) === JSON.stringify(parsed)
        ? original
        : JSON.stringify(next, null, 2);
    });
  } catch (error) {
    // 损坏文件维持既有空覆盖语义，不覆盖原文；IO 错误不冒充迁移成功。
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function migrateFile(
  path: string,
  transform: (original: string) => string,
): Promise<boolean> {
  const info = await lstat(path);
  if (!info.isFile()) return false;
  return withFileLock(path, async () => {
    const before = await lstat(path);
    if (!before.isFile() || (before.mode & 0o222) === 0) return false;
    const original = await readFile(path, "utf8");
    const next = transform(original);
    if (next === original) return false;
    const directory = dirname(path);
    const physicalDirectory = await realpath(directory);
    const temp = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, next, { flag: "wx", mode: before.mode & 0o777 });
      await chmod(temp, before.mode & 0o777);
      // 外部编辑器不持有应用锁：写前比较原文和文件身份，不能覆盖并发修改。
      const current = await lstat(path);
      if (
        !current.isFile() ||
        current.ino !== before.ino ||
        current.dev !== before.dev ||
        (await realpath(directory)) !== physicalDirectory ||
        (await readFile(path, "utf8")) !== original
      ) {
        throw new Error("Subagent file changed during migration");
      }
      await rename(temp, path);
      return true;
    } finally {
      await rm(temp, { force: true });
    }
  });
}
