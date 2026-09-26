#!/usr/bin/env node
/* eslint-disable max-lines -- 冒烟脚本集中编排复制/构建/断言步骤，保持单文件闭环更易对照工作流审计。 */

// 本地 Windows 安装包交叉打包冒烟工具：在 Linux Docker 容器里复刻
// .github/workflows/release-desktop.yml 的构建步骤，让工作流/打包脚本改动
// 在推送远端之前可以先在本地闭环验证。
//
// 设计约束（与仓库发布流程对齐）：
// - ~/temp/zcode-smoke/<run-id>/ 只保留日志与产物，默认在退出时清理（--keep 保留）；
// - 构建工作区与 pnpm/electron 下载缓存放在 Docker named volume（不在 ~/temp 留文件）：
//   默认每次完整重置工作区（干净语义，依赖从缓存 store 重装，约几分钟），
//   --skip-install 则保留上次工作区并用 rsync 同步源码改动（含删除），只重跑打包阶段；
// - 镜像默认全部保留：基础镜像（node:<ver>-bookworm-slim）永不删除，
//   项目构建镜像 zcode-smoke-win-cross 也默认保留，仅 --prune-image 显式删除。

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCommand } from "./spawn-command.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const cacheVolumeName = "zcode-smoke-cache";
const cacheMountDir = "/cache";
const minFreeDiskBytes = 15 * 1024 * 1024 * 1024;
// 暂存/同步都按 basename 在任意层级排除；这里排除的是可再生构建产物，
// 避免宿主几十 GB 的 node_modules 进入暂存包，也避免 rsync 覆盖工作区里的同名目录。
const stagingExcludeNames = [
  "node_modules",
  ".git",
  "dist",
  "out",
  "bundled-agents",
  "bundled-tools",
  "mock-cdn",
  "dist-cua-helper",
  ".e2e-cache",
  ".e2e-artifacts",
  ".e2e-home-*",
  ".tmp",
  ".turbo",
  "coverage",
];

function printHelp() {
  console.log(`Windows 安装包本地交叉打包冒烟工具

用法:
  pnpm smoke:windows-bundle [选项]

选项:
  --registry <url>    容器内 pnpm 使用的 npm registry（默认跟随宿主 NPM_CONFIG_REGISTRY，
                      未设置时为 npmjs 官方源；网络不稳建议 --registry https://registry.npmmirror.com）
  --skip-install      复用 Docker volume 中上次的工作区（rsync 同步源码改动），只重跑打包阶段
  --out <dir>         成功后把安装包与 sha256 额外复制到该目录（默认运行结束即清理）
  --keep              保留本次运行目录（默认清理 ~/temp/zcode-smoke/<run-id>）
  --no-cache          docker build 不使用层缓存重建项目镜像
  --prune-image       只删除项目构建镜像（基础 node 镜像不受影响）后退出
  --prune-caches      只删除缓存 named volume（构建工作区与下载缓存）后退出
  --force             跳过宿主平台检查（非 linux/amd64 上 wine/i386 基本不可用）
  -h, --help          查看帮助

行为:
  容器内执行与 release-desktop.yml 相同的步骤：
    pnpm install --frozen-lockfile
    ZCODE_ENV=production pnpm bundle:desktop -- --os win --arch x64 --skip-prepare
  默认每次重置工作区后从缓存 store 重装依赖（干净但较慢，约几分钟）；
  快速迭代请用 --skip-install 复用上次工作区。
`);
}

function parseArgs(argv) {
  const options = {
    registry: process.env.NPM_CONFIG_REGISTRY?.trim() || null,
    skipInstall: false,
    outDir: null,
    keep: false,
    noCache: false,
    pruneImage: false,
    pruneCaches: false,
    force: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "--skip-install") {
      options.skipInstall = true;
      continue;
    }

    if (arg === "--keep") {
      options.keep = true;
      continue;
    }

    if (arg === "--no-cache") {
      options.noCache = true;
      continue;
    }

    if (arg === "--prune-image") {
      options.pruneImage = true;
      continue;
    }

    if (arg === "--prune-caches") {
      options.pruneCaches = true;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "--registry" || arg === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${arg} 需要一个参数值`);
      }
      if (arg === "--registry") {
        options.registry = value;
      } else {
        options.outDir = resolve(value);
      }
      index += 1;
      continue;
    }

    throw new Error(`不支持的参数: ${arg}`);
  }

  return options;
}

function run(command, args, options = {}) {
  runCommand(command, args, options);
}

function runAndReadStdout(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || (typeof result.status === "number" && result.status !== 0)) {
    return null;
  }
  return result.stdout?.trim() ?? null;
}

function readPinnedNodeVersion() {
  const match = readFileSync(join(repoRoot, "mise.toml"), "utf8").match(
    /^\s*node\s*=\s*"([^"]+)"/m,
  );
  if (!match) {
    throw new Error("mise.toml 中未找到 node 版本");
  }
  return match[1].trim();
}

function readPinnedPnpmVersion() {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const packageManager = packageJson.packageManager;
  if (typeof packageManager !== "string" || !packageManager.startsWith("pnpm@")) {
    throw new Error(`package.json packageManager 字段异常: ${String(packageManager)}`);
  }
  return packageManager.slice("pnpm@".length);
}

function preflight(force) {
  if (process.platform !== "linux") {
    throw new Error("本工具只支持 Linux 宿主（依赖 tar/statfs 与 linux 容器）");
  }

  const dockerInfo = runAndReadStdout("docker", [
    "info",
    "--format",
    "{{.OSType}} {{.Architecture}}",
  ]);
  if (!dockerInfo) {
    throw new Error("docker 不可用，请确认 Docker 已安装并启动");
  }

  const [osType, architecture] = dockerInfo.split(/\s+/);
  const isAmd64 = architecture === "amd64" || architecture === "x86_64";
  if (osType !== "linux" || !isAmd64) {
    if (!force) {
      throw new Error(
        `Docker 服务端为 ${dockerInfo}；wine/i386 交叉打包仅支持 linux/amd64，确认无碍请加 --force`,
      );
    }
    console.warn(`[smoke] --force 跳过平台检查（${dockerInfo}），交叉打包大概率失败`);
  }

  const tempRoot = join(homedir(), "temp");
  mkdirSync(tempRoot, { recursive: true });
  const stats = statfsSync(tempRoot);
  const freeBytes = stats.bavail * stats.bsize;
  if (freeBytes < minFreeDiskBytes) {
    throw new Error(
      `${tempRoot} 可用空间不足：${Math.floor(freeBytes / 1024 / 1024 / 1024)}GiB < 15GiB`,
    );
  }

  return tempRoot;
}

function resolveCommitId() {
  return runAndReadStdout("git", ["-C", repoRoot, "rev-parse", "--short=8", "HEAD"]) ?? "unknown";
}

function buildProjectImage(nodeVersion, pnpmVersion, noCache) {
  const imageTag = `zcode-smoke-win-cross:node-${nodeVersion}`;
  console.log(`[smoke] 构建项目镜像 ${imageTag}（基础镜像会保留在本机）`);
  run(
    "docker",
    [
      "build",
      ...(noCache ? ["--no-cache"] : []),
      "--build-arg",
      `NODE_VERSION=${nodeVersion}`,
      "--build-arg",
      `PNPM_VERSION=${pnpmVersion}`,
      "-t",
      imageTag,
      "-f",
      join("scripts", "docker", "Dockerfile.windows-cross"),
      join("scripts", "docker"),
    ],
    { cwd: repoRoot },
  );
  return imageTag;
}

// named volume 首次创建时归 root 所有；只做一次非递归 chown 让宿主 uid 可写，
// 之后容器内的子目录全部由同一 uid 创建，不会再出现属主任期漂移。
function ensureCacheVolumeOwnership(imageTag) {
  run("docker", [
    "run",
    "--rm",
    "--user",
    "0:0",
    "-v",
    `${cacheVolumeName}:${cacheMountDir}`,
    imageTag,
    "chown",
    `${process.getuid()}:${process.getgid()}`,
    cacheMountDir,
  ]);
}

// 暂存的是“当前工作区”而不是某个 commit：冒烟的对象就是开发者手上的改动，
// 不要求先提交才能验证。产物目录被排除，最终由容器内构建重新生成。
function stageWorkingTreeTarball(runDir) {
  const archivePath = join(runDir, "staged-tree.tar");
  console.log("[smoke] 暂存当前工作区（含未提交改动，不含构建产物）");
  const excludeArgs = stagingExcludeNames.flatMap((name) => ["--exclude", name]);
  run("tar", ["-cf", archivePath, ...excludeArgs, "-C", repoRoot, "."]);
  return archivePath;
}

function createContainerScript(options) {
  const excludeRules = stagingExcludeNames.flatMap((name) => ["--exclude", name]);
  // 默认完整重置工作区再解包：语义干净，代价是依赖从缓存 store 重装（几分钟）。
  // --skip-install 用 rsync 把源码改动（含删除）合并进上次工作区，保留 node_modules
  // 等被排除目录，实现只重跑打包阶段的快速迭代。
  const syncWorkdir = options.skipInstall
    ? [
        "mkdir -p /cache/workdir /tmp/staged-src",
        "tar -xf /staged-tree.tar -C /tmp/staged-src",
        `rsync -a --delete ${excludeRules.join(" ")} /tmp/staged-src/ /cache/workdir/`,
      ].join("\n")
    : [
        "rm -rf /cache/workdir",
        "mkdir -p /cache/workdir",
        "tar -xf /staged-tree.tar -C /cache/workdir",
      ].join("\n");
  const installCommands = options.skipInstall
    ? ""
    : [
        `pnpm install --frozen-lockfile --fetch-retries 5 --store-dir ${cacheMountDir}/pnpm-store \\`,
        `  || { echo "[smoke] install 失败，重试一次"; sleep 5; pnpm install --frozen-lockfile --fetch-retries 5 --store-dir ${cacheMountDir}/pnpm-store; }`,
      ].join("\n");

  return [
    "set -euo pipefail",
    // wine 要求 HOME 目录属主是当前用户；/tmp 是 root 属主的 sticky 目录，
    // 直接用 HOME=/tmp 会在 wine 创建配置目录时被拒绝。
    "mkdir -p /tmp/zcode-home",
    `mkdir -p ${cacheMountDir}/pnpm-store ${cacheMountDir}/electron ${cacheMountDir}/electron-builder`,
    syncWorkdir,
    "cd /cache/workdir",
    installCommands,
    // 与 release-desktop.yml 的 Build 步骤保持同一组环境变量；改动需同步两侧。
    "pnpm bundle:desktop -- --os win --arch x64 --skip-prepare",
    "ls -la packages/desktop/dist/*.exe",
    "cp packages/desktop/dist/ZCode-*-win-x64.exe /out/",
  ]
    .filter(Boolean)
    .join("\n");
}

function runContainerBuild({ imageTag, runDir, archivePath, options, commitId }) {
  const logPath = join(runDir, "smoke.log");
  const outDir = join(runDir, "artifacts");
  mkdirSync(outDir, { recursive: true });
  const containerScript = createContainerScript(options);

  const dockerArgs = [
    "run",
    "--rm",
    `--name=zcode-smoke-${process.pid}`,
    "--user",
    `${process.getuid()}:${process.getgid()}`,
    "-e",
    "HOME=/tmp/zcode-home",
    "-e",
    "HUSKY=0",
    "-e",
    "ZCODE_ENV=production",
    "-e",
    "ZCODE_SKIP_REMOTE_ASSETS=1",
    "-e",
    `ZCODE_COMMIT=${commitId}`,
    "-e",
    "ELECTRON_CACHE=/cache/electron",
    "-e",
    "ELECTRON_BUILDER_CACHE=/cache/electron-builder",
    ...(options.registry ? ["-e", `NPM_CONFIG_REGISTRY=${options.registry}`] : []),
    "-v",
    `${archivePath}:/staged-tree.tar:ro`,
    "-v",
    `${outDir}:/out`,
    "-v",
    `${cacheVolumeName}:${cacheMountDir}`,
    // 不能用 -w 指到 volume 内路径：workdir 缺失时 docker 守护进程会以 root 重建
    // /cache 并把 volume 根属主重置回 root，覆盖 chown 初始化；容器脚本自行 cd。
    imageTag,
    "bash",
    "-c",
    containerScript,
  ];

  console.log(`[smoke] 容器内执行构建（日志: ${logPath}）`);
  // 输出同时进终端与日志文件；pipefail 保证 docker 失败时脚本拿到非零退出码。
  run("bash", [
    "-c",
    `set -o pipefail; docker ${shellJoin(dockerArgs)} 2>&1 | tee ${quote(logPath)}`,
  ]);

  const installerPath = findInstallerInDir(outDir);
  if (!installerPath) {
    throw new Error("容器构建成功但 /out 未带回 ZCode-*-win-x64.exe 产物");
  }
  reportArtifact(installerPath, options);
}

function findInstallerInDir(directory) {
  if (!existsSync(directory)) {
    return null;
  }
  const candidates = readdirSync(directory).filter((name) => /^ZCode-.*-win-x64\.exe$/.test(name));
  return candidates.length > 0 ? join(directory, candidates[0]) : null;
}

function reportArtifact(installerPath, options) {
  const fileName = basename(installerPath);
  const bytes = readFileSync(installerPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(`${installerPath}.sha256`, `${sha256}  ${fileName}\n`, "utf8");

  console.log(`[smoke] 产物: ${installerPath}`);
  console.log(`[smoke] 大小: ${bytes.length} bytes  sha256=${sha256}`);

  if (options.outDir) {
    mkdirSync(options.outDir, { recursive: true });
    copyFileSync(installerPath, join(options.outDir, fileName));
    copyFileSync(`${installerPath}.sha256`, join(options.outDir, `${fileName}.sha256`));
    console.log(`[smoke] 已复制到 --out 目录: ${options.outDir}`);
  }
}

function shellJoin(args) {
  return args.map((arg) => (/[^\w@%+=:,./-]/.test(arg) ? quote(arg) : arg)).join(" ");
}

function quote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function printLogTail(logPath, maxLines = 40) {
  if (!existsSync(logPath)) {
    return;
  }
  const lines = readFileSync(logPath, "utf8").split("\n");
  console.error(
    `\n[smoke] 失败，日志末尾（完整日志 ${logPath}）:\n${lines.slice(-maxLines).join("\n")}`,
  );
}

function prune(options) {
  if (options.pruneImage) {
    const nodeVersion = readPinnedNodeVersion();
    // 只删项目构建镜像；基础 node 镜像属于公共构建资源，按约定永不删除。
    run("docker", ["rmi", `zcode-smoke-win-cross:node-${nodeVersion}`]);
    console.log(`[smoke] 已删除项目镜像 zcode-smoke-win-cross:node-${nodeVersion}`);
  }
  if (options.pruneCaches) {
    run("docker", ["volume", "rm", cacheVolumeName]);
    console.log(`[smoke] 已删除缓存 volume ${cacheVolumeName}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (options.pruneImage || options.pruneCaches) {
    prune(options);
    return;
  }

  const tempRoot = preflight(options.force);
  const smokeRoot = join(tempRoot, "zcode-smoke");
  mkdirSync(smokeRoot, { recursive: true });
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${process.pid}`;
  const runDir = join(smokeRoot, runId);
  if (dirname(runDir) !== smokeRoot) {
    throw new Error(`运行目录越界: ${runDir}`);
  }
  mkdirSync(runDir, { recursive: true });

  const logPath = join(runDir, "smoke.log");
  try {
    const nodeVersion = readPinnedNodeVersion();
    const pnpmVersion = readPinnedPnpmVersion();
    const commitId = resolveCommitId();
    console.log(
      `[smoke] node=${nodeVersion} pnpm=${pnpmVersion} commit=${commitId} skipInstall=${options.skipInstall}`,
    );

    const imageTag = buildProjectImage(nodeVersion, pnpmVersion, options.noCache);
    ensureCacheVolumeOwnership(imageTag);
    const archivePath = stageWorkingTreeTarball(runDir);

    runContainerBuild({ imageTag, runDir, archivePath, options, commitId });
    console.log("[smoke] 冒烟通过：本地已复刻 release-desktop.yml 的 Windows 打包链路");
  } catch (error) {
    printLogTail(logPath);
    throw error;
  } finally {
    if (options.keep) {
      console.log(`[smoke] --keep：保留运行目录 ${runDir}（含日志与产物）`);
    } else {
      // 默认清理本次运行目录（日志、产物、暂存包）；构建工作区与缓存 volume、
      // 镜像按约定保留在 Docker 内，供下次快速复跑。
      rmSync(runDir, { force: true, recursive: true });
      console.log("[smoke] 已清理本次运行目录（--keep 可保留；镜像与缓存默认保留）");
    }
  }
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryHref === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(`[smoke] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
