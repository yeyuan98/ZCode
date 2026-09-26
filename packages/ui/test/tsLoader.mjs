/**
 * UI 单测的模块解析钩子（node --test 原生 TS 直跑的补充）：
 *
 * 1. 仓库源码内部一律用 `.js` 说明符引用 `.ts` 源文件（tsc/project-references 约定），
 *    Node 原生 resolver 不会做 `.js` → `.ts` 回映射；这里在目标 `.ts`/`.tsx` 真实存在时重写。
 * 2. UI 源码使用 `@/` 路径别名（tsconfig paths），Node 不识别；这里映射到 `src/`。
 *
 * 只在候选 `.ts`/`.tsx` 文件存在时重写，真实 JS 依赖（node_modules 内的 .js）不受影响。
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mapToExistingSource(baseName) {
  if (!baseName.endsWith(".js")) {
    return null;
  }
  const withoutExtension = baseName.slice(0, -3);
  for (const candidate of [`${withoutExtension}.ts`, `${withoutExtension}.tsx`]) {
    const filePath = path.resolve(uiRoot, "src", candidate);
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

function mapRelativeToExistingSource(specifier, parentPath) {
  if (!specifier.endsWith(".js")) {
    return null;
  }
  const parentDir = path.dirname(parentPath);
  const withoutExtension = specifier.slice(0, -3);
  for (const candidate of [`${withoutExtension}.ts`, `${withoutExtension}.tsx`]) {
    const filePath = path.resolve(parentDir, candidate);
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const mapped = mapToExistingSource(specifier.slice(2));
    if (mapped) {
      return next(pathToFileURL(mapped).href, context);
    }
  }

  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    typeof context.parentURL === "string" &&
    context.parentURL.startsWith("file:")
  ) {
    try {
      const parentPath = fileURLToPath(context.parentURL);
      const mapped = mapRelativeToExistingSource(specifier, parentPath);
      if (mapped) {
        return next(pathToFileURL(mapped).href, context);
      }
    } catch {
      // 非 file: parent（data:/node:）直接走默认解析。
    }
  }

  return next(specifier, context);
}
