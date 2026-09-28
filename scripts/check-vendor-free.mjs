#!/usr/bin/env node
/**
 * P6 vendor-free 门禁（设计记录：specs/vendor-free-gate-and-ci.md）。
 *
 * 只匹配五个"确凿"厂商标识模式（域名/账号标识，只可能指厂商）。刻意不匹配
 * `glm`：GLM 是受支持的普通模型族（目录含 glm-5.3 等规则），provider 图标组件
 * 名也合法含 "Glm"，匹配它会迫使复杂 allowlist 而零安全收益（用户指令 1）。
 *
 * 结构性排除：CHANGELOG.md（release-it 生成物）、VENDOR-PURGE-PLAN.md 与
 * specs/（审计文档必须引用其所禁字符串）。二进制按扩展名跳过（保险；当前五
 * 模式在二进制/lockfile 均零命中）。Allowlist 逐条携带理由，全部为负向断言
 * 测试（断言厂商标识不回流，字面量必须存在才能断言其不存在）。
 *
 * 用法：node scripts/check-vendor-free.mjs [--list]
 *   默认严格模式：存在未豁免命中时 exit 1。--list 额外打印豁免命中与统计。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import process from "node:process";

export const VENDOR_PATTERNS = [
  { id: "zcode-domain", source: "zcode\\.z\\.ai" },
  { id: "cdn-zcode", source: "cdn-zcode" },
  { id: "chat-domain", source: "chat\\.z\\.ai" },
  { id: "zhipu-account", source: "zhipu-account" },
  { id: "com-zhipu", source: "com\\.zhipu" },
].map(({ id, source }) => ({ id, regex: new RegExp(source, "i") }));

export const EXCLUDED_PATHS = new Set([
  "CHANGELOG.md",
  "VENDOR-PURGE-PLAN.md",
  // 门禁自身的模式表与单测合成语料必须包含被禁字面量（定义处即引用处）。
  "scripts/check-vendor-free.mjs",
  "scripts/check-vendor-free.test.mjs",
]);
export const EXCLUDED_PREFIXES = ["specs/"];
export const BINARY_EXTENSIONS = new Set([
  ".png", ".ico", ".icns", ".webp", ".gif", ".bmp", ".mp3", ".wav", ".gz", ".zip",
  ".tar", ".node", ".exe", ".dll", ".so", ".dylib", ".woff", ".woff2", ".ttf",
  ".otf", ".map", ".wasm", ".pdf", ".jar",
]);

export const ALLOWLIST = [
  {
    file: "packages/shared/test/endpointWebPurge.test.ts",
    reason: "负向断言：断言 com.zhipu 等厂商标识不回流（endpoint web 清除守卫）",
  },
  {
    file: "packages/shared/test/pluginMarketplacesP5.test.ts",
    reason: "负向断言：断言 cdn-zcode.z.ai 不回流（市场守卫）",
  },
  {
    file: "packages/services/test/providerVendorAccessExcision.test.ts",
    reason: "负向断言：厂商访问链路清除守卫（字面量必须存在）",
  },
];

export function classifyPath(path) {
  if (EXCLUDED_PATHS.has(path)) return "excluded";
  if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) return "excluded";
  if (BINARY_EXTENSIONS.has(extname(path).toLowerCase())) return "binary";
  if (ALLOWLIST.some((entry) => entry.file === path)) return "allowlisted";
  return "scanned";
}

export function scanText(text) {
  const hits = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const { id, regex } of VENDOR_PATTERNS) {
      if (regex.test(line)) hits.push({ line: index + 1, pattern: id, text: line.trim() });
    }
  }
  return hits;
}

/** 对虚拟文件集执行扫描（单测使用合成语料，不自扫仓库）。 */
export function runScan(fileMap) {
  const violations = [];
  const allowlistedHits = [];
  let excluded = 0;
  let binary = 0;
  for (const [path, text] of fileMap) {
    const status = classifyPath(path);
    if (status === "excluded") {
      excluded += 1;
      continue;
    }
    if (status === "binary") {
      binary += 1;
      continue;
    }
    const hits = scanText(text);
    if (hits.length === 0) continue;
    if (status === "allowlisted") allowlistedHits.push({ path, hits });
    else violations.push({ path, hits });
  }
  return { violations, allowlistedHits, excluded, binary };
}

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return output.split("\0").filter((path) => path.length > 0);
}

function main() {
  const listMode = process.argv.includes("--list");
  const fileMap = new Map();
  for (const path of listTrackedFiles()) {
    if (classifyPath(path) !== "scanned" && classifyPath(path) !== "allowlisted") continue;
    fileMap.set(path, readFileSync(path, "utf8"));
  }
  const { violations, allowlistedHits, excluded, binary } = runScan(fileMap);

  for (const { path, hits } of violations) {
    for (const hit of hits) {
      console.error(`VIOLATION ${path}:${hit.line} [${hit.pattern}] ${hit.text}`);
    }
  }
  if (listMode) {
    for (const { path, hits } of allowlistedHits) {
      for (const hit of hits) {
        console.log(`allowlisted ${path}:${hit.line} [${hit.pattern}] ${hit.text}`);
      }
    }
  }

  const violationCount = violations.reduce((sum, { hits }) => sum + hits.length, 0);
  const allowlistedCount = allowlistedHits.reduce((sum, { hits }) => sum + hits.length, 0);
  console.log(
    `vendor-free: ${violationCount} 未豁免命中（${violations.length} 文件）；` +
      `${allowlistedCount} 豁免命中；排除 ${excluded}，二进制跳过 ${binary}。`,
  );

  if (violationCount > 0) {
    console.error(
      "修复或按 specs/vendor-free-gate-and-ci.md 的 allowlist 结构补豁免条目（须带理由）。",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith("check-vendor-free.mjs")) {
  main();
}
