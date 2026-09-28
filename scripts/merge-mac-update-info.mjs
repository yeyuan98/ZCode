#!/usr/bin/env node
/**
 * D8：合并 macOS 双 arch 各自生成的 latest-mac.yml（设计记录：specs/rebrand-and-final-release.md）。
 *
 * electron-builder 每次（每个 arch）构建都会写一份只含本 arch 条目的 latest-mac.yml，
 * 直接上传会互相覆盖；electron-updater 6.8.3 依赖合并后 files[] 里带 -arm64/-x64
 * 后缀的 URL 选择架构条目。因此 release-macos-channel 作业用本脚本把两份 feed
 * 合成一份：files[] 按输入顺序拼接（workflow 固定先传 arm64），version/path/sha512/
 * releaseDate 取第一个输入，且两份 version 必须一致。
 *
 * 固定形状（version / releaseDate? / path? / sha512? / files[]{url,sha512,size}）
 * 手写极简解析，不引入 yaml 依赖；未知顶层字段直接报错，feed 结构漂移时显式失败。
 *
 * 用法：node scripts/merge-mac-update-info.mjs --input <dirA> --input <dirB> --out <file>
 *   每个输入目录必须恰好包含一个 latest-mac.yml；校验失败（版本不一致、缺
 *   sha512/size、URL 架构标记缺失或重复、zip 条目不足 2 条）时 exit 1。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import process from "node:process";

const KNOWN_TOP_LEVEL_KEYS = new Set(["version", "releaseDate", "path", "sha512"]);
const REQUIRED_FILE_KEYS = ["url", "sha512"];

/** 标量按 YAML 习惯处理：纯数字转 number，引号剥离，其余原样返回。 */
function parseScalar(value) {
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** 解析 latest-mac.yml 的固定形状；结构外的行直接抛错（feed 漂移必须显式失败）。 */
export function parseLatestMac(text) {
  const doc = { files: [] };
  let currentFile = null;
  let sawFiles = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.trim().length === 0 || line.trim().startsWith("#")) continue;
    const listItem = /^(\s*)-\s+(\w+):\s*(.*)$/.exec(line);
    if (listItem) {
      if (!sawFiles) {
        throw new Error(`files 列表之外出现列表项：${line.trim()}`);
      }
      currentFile = {};
      doc.files.push(currentFile);
      currentFile[listItem[2]] = parseScalar(listItem[3]);
      continue;
    }
    const nested = /^\s+(\w+):\s*(.*)$/.exec(line);
    if (nested && currentFile) {
      currentFile[nested[1]] = parseScalar(nested[2]);
      continue;
    }
    const topLevel = /^(\w+):\s*(.*)$/.exec(line);
    if (topLevel) {
      currentFile = null;
      const key = topLevel[1];
      if (key === "files") {
        if (topLevel[2].trim().length > 0) {
          throw new Error(`latest-mac.yml 的 files 只支持列表形式，收到：${line.trim()}`);
        }
        sawFiles = true;
        continue;
      }
      if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
        throw new Error(`latest-mac.yml 出现未知顶层字段 ${key}（feed 结构漂移，需人工确认）`);
      }
      doc[key] = parseScalar(topLevel[2]);
      continue;
    }
    throw new Error(`无法解析的 latest-mac.yml 行：${line.trim()}`);
  }
  return doc;
}

/** URL 必须恰好携带 -arm64 或 -x64 之一，否则无法定位架构。 */
function archOfUrl(url) {
  const hasArm64 = url.includes("-arm64");
  const hasX64 = url.includes("-x64");
  if (hasArm64 === hasX64) {
    throw new Error(`files[].url 缺少唯一的 -arm64/-x64 架构标记：${url}`);
  }
  return hasArm64 ? "arm64" : "x64";
}

function validateDoc(doc, label) {
  if (typeof doc.version !== "string" || doc.version.length === 0) {
    throw new Error(`${label} 缺少 version`);
  }
  if (!Array.isArray(doc.files) || doc.files.length === 0) {
    throw new Error(`${label} 的 files 为空`);
  }
  const arches = new Set();
  for (const entry of doc.files) {
    for (const key of REQUIRED_FILE_KEYS) {
      if (typeof entry[key] !== "string" || entry[key].length === 0) {
        throw new Error(`${label} 存在缺少 ${key} 的 files 条目`);
      }
    }
    if (!Number.isInteger(entry.size) || entry.size <= 0) {
      throw new Error(`${label} 存在 size 缺失或非正整数的 files 条目（url: ${entry.url}）`);
    }
    arches.add(archOfUrl(entry.url));
  }
  if (arches.size !== 1) {
    throw new Error(`${label} 的 files 混杂多个架构标记：${[...arches].join(",")}`);
  }
  return [...arches][0];
}

/** 与 electron-builder 输出保持同一字段顺序（version/files/path/sha512/releaseDate）。 */
function formatLatestMac(doc) {
  const lines = [`version: ${doc.version}`, "files:"];
  for (const entry of doc.files) {
    lines.push(`  - url: ${entry.url}`);
    lines.push(`    sha512: ${entry.sha512}`);
    lines.push(`    size: ${entry.size}`);
  }
  if (doc.path !== undefined) lines.push(`path: ${doc.path}`);
  if (doc.sha512 !== undefined) lines.push(`sha512: ${doc.sha512}`);
  if (doc.releaseDate !== undefined) lines.push(`releaseDate: '${doc.releaseDate}'`);
  return `${lines.join("\n")}\n`;
}

/**
 * 合并两份单 arch latest-mac.yml 文本，返回合并后的 YAML 文本。
 * 顺序契约：files[] 先列第一个输入的全部条目（保持其 zip 在前的原序），
 * 再列第二个输入的；顶层元数据（version/path/sha512/releaseDate）取第一个输入。
 */
export function mergeLatestMac(aText, bText) {
  const a = parseLatestMac(aText);
  const b = parseLatestMac(bText);
  const aArch = validateDoc(a, "输入 1");
  const bArch = validateDoc(b, "输入 2");
  if (a.version !== b.version) {
    throw new Error(`两个输入的 version 不一致（${a.version} vs ${b.version}），拒绝合并`);
  }
  if (aArch === bArch) {
    throw new Error(`两个输入的架构重复（均为 ${aArch}），需要 -arm64 与 -x64 各一份`);
  }
  const files = [...a.files, ...b.files];
  const urls = new Set(files.map((entry) => entry.url));
  if (urls.size !== files.length) {
    throw new Error("合并后的 files 存在重复 url");
  }
  const zipCount = files.filter((entry) => entry.url.endsWith(".zip")).length;
  if (zipCount < 2) {
    throw new Error(`合并后的 zip 条目只有 ${zipCount} 条（每个 arch 各需一条作为更新入口）`);
  }
  return formatLatestMac({ ...a, files });
}

/** 输入目录必须恰好包含一个 latest-mac.yml（子目录方案下目录里只有这一份文件）。 */
function findLatestMacPath(dir) {
  const candidates = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^latest-mac.*\.yml$/.test(entry.name))
    .map((entry) => entry.name);
  if (candidates.length !== 1 || candidates[0] !== "latest-mac.yml") {
    throw new Error(
      `输入目录 ${dir} 必须恰好包含一个 latest-mac.yml，实际：${candidates.join(", ") || "无"}`,
    );
  }
  return join(dir, "latest-mac.yml");
}

function parseArgs(argv) {
  const inputs = [];
  let out = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") {
      inputs.push(argv[index + 1]);
      index += 1;
    } else if (arg === "--out") {
      out = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
    if (inputs.includes(undefined) || out === undefined) {
      throw new Error(`${arg} 需要一个值`);
    }
  }
  return { inputs, out };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.inputs.length !== 2) {
      throw new Error("--input 需要恰好 2 个（arm64 与 x64 各一个目录）");
    }
    if (!args.out) {
      throw new Error("--out 必填（合并后的 latest-mac.yml 路径）");
    }
    const merged = mergeLatestMac(
      readFileSync(findLatestMacPath(args.inputs[0]), "utf8"),
      readFileSync(findLatestMacPath(args.inputs[1]), "utf8"),
    );
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, merged);
    const fileCount = parseLatestMac(merged).files.length;
    console.log(
      `mac channel: ${args.inputs.join(" + ")} → ${args.out}（${fileCount} 个 files 条目）`,
    );
  } catch (error) {
    console.error(`merge-mac-update-info: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith("merge-mac-update-info.mjs")) {
  main();
}
