import assert from "node:assert/strict";
import { accessSync } from "node:fs";
import test from "node:test";
import {
  ALLOWLIST,
  classifyPath,
  runScan,
  scanText,
} from "./check-vendor-free.mjs";

test("scanText：五个模式全部命中且大小写不敏感", () => {
  const text = [
    "const a = 'https://zcode.z.ai/docs';",
    "const b = 'CDN-ZCODE mirror';",
    "const c = 'chat.z.ai/oauth';",
    "const d = 'zhipu-account scope';",
    "const e = 'Com.Zhipu.Api';",
    "const safe = 'https://github.com/yeyuan98/ZCode';",
  ].join("\n");
  const patterns = scanText(text).map((hit) => hit.pattern);
  assert.deepEqual(patterns, [
    "zcode-domain",
    "cdn-zcode",
    "chat-domain",
    "zhipu-account",
    "com-zhipu",
  ]);
});

test("scanText：行号从 1 计，多模式同行均报告", () => {
  const hits = scanText("plain\nzcode.z.ai and cdn-zcode together");
  assert.deepEqual(
    hits.map((hit) => [hit.line, hit.pattern]),
    [
      [2, "zcode-domain"],
      [2, "cdn-zcode"],
    ],
  );
});

test("scanText：glm 不是模式（普通模型族合法存在）", () => {
  assert.deepEqual(scanText("const model = 'glm-5.3';\nGlmMonochromeIcon"), []);
});

test("classifyPath：排除/二进制/豁免/扫描四类", () => {
  assert.equal(classifyPath("CHANGELOG.md"), "excluded");
  assert.equal(classifyPath("VENDOR-PURGE-PLAN.md"), "excluded");
  assert.equal(classifyPath("specs/vendor-free-gate-and-ci.md"), "excluded");
  assert.equal(classifyPath("packages/desktop/build/icon.png"), "binary");
  assert.equal(classifyPath("tools/ugrep.zip"), "binary");
  assert.equal(classifyPath("packages/shared/test/endpointWebPurge.test.ts"), "allowlisted");
  assert.equal(classifyPath("packages/ui/src/lib/productDocs.ts"), "scanned");
});

test("runScan：未豁免命中构成 violation，豁免文件命中不算", () => {
  const fileMap = new Map([
    ["src/a.ts", "visit zcode.z.ai now"],
    ["packages/shared/test/endpointWebPurge.test.ts", "assert !text.includes('com.zhipu')"],
    ["specs/audit.md", "banned string zcode.z.ai documented"],
    ["assets/icon.png", "binary"],
  ]);
  const result = runScan(fileMap);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].path, "src/a.ts");
  assert.equal(result.allowlistedHits.length, 1);
  assert.equal(result.excluded, 1);
  assert.equal(result.binary, 1);
});

test("runScan：干净语料零命中零退出风险", () => {
  const result = runScan(new Map([["src/clean.ts", "nothing to see"]]));
  assert.equal(result.violations.length, 0);
  assert.equal(result.allowlistedHits.length, 0);
});

test("allowlist：每条目都是真实存在的测试文件（防路径拼错静默失效）", () => {
  for (const entry of ALLOWLIST) {
    accessSync(entry.file);
    assert.ok(entry.reason.length > 0, `${entry.file} 缺少豁免理由`);
  }
});
