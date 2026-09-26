/**
 * services 单测的模块解析与加载钩子（node --test 直跑仓库 TS 源码的补充）：
 *
 * 1. 仓库源码内部一律用 `.js` 说明符引用 `.ts` 源文件（tsc/project-references 约定），
 *    Node 原生 resolver 不会做 `.js` → `.ts` 回映射；这里在目标 `.ts` 真实存在时重写。
 * 2. services 源码使用 `#src/*` 包内导入（package.json imports 字段），Node 只做字面映射，
 *    同样无法回映射到 `.ts`；这里映射到本包 `src/` 下的真实源文件。
 * 3. Node 原生类型剥离不做跨文件导入省略（如 packages/rpc 的 protocol.ts 把接口与运行时值
 *    混在同一条 import 里），模块实例化会因 "does not provide an export named" 失败；
 *    这里用 esbuild 按文件转换 TS（与应用构建器一致地带走仅类型导入），仓库源码全部走该转换，
 *    node_modules 内的真实 JS 不受影响。
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { transform } from "esbuild";

const servicesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mapRelativeToExistingSource(specifier, parentPath) {
  if (!specifier.endsWith(".js")) {
    return null;
  }
  const parentDir = path.dirname(parentPath);
  const withoutExtension = specifier.slice(0, -3);
  const filePath = path.resolve(parentDir, `${withoutExtension}.ts`);
  return existsSync(filePath) ? filePath : null;
}

function mapPackageSelfImportToExistingSource(specifier) {
  if (!specifier.startsWith("#src/") || !specifier.endsWith(".js")) {
    return null;
  }
  const withoutExtension = specifier.slice("#src/".length, -".js".length);
  const filePath = path.resolve(servicesRoot, "src", `${withoutExtension}.ts`);
  return existsSync(filePath) ? filePath : null;
}

// pnpm workspace 依赖经 node_modules 符号链接指向仓库 TS 源码，其 URL 仍带 /node_modules/，
// 因此不能按路径排除；真实第三方依赖只发布 .js，按扩展名过滤即可只命中仓库 TS 源文件。
function isRepoTypeScriptSource(url) {
  if (!url.startsWith("file:")) {
    return false;
  }
  return /\.(ts|mts|tsx)$/.test(new URL(url).pathname);
}

export async function resolve(specifier, context, next) {
  const selfImport = mapPackageSelfImportToExistingSource(specifier);
  if (selfImport) {
    return next(pathToFileURL(selfImport).href, context);
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

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!isRepoTypeScriptSource(url) || result.source == null) {
    return result;
  }
  // Node 的默认 load 对文件返回 Buffer（而非 string），esbuild 两种都接受。
  const { code } = await transform(result.source, {
    loader: url.endsWith(".tsx") ? "tsx" : "ts",
    format: "esm",
    target: "node22",
    sourcemap: "inline",
  });
  return { format: "module", source: code, shortCircuit: true };
}
