import assert from "node:assert/strict";
import test from "node:test";
import { createDecipheriv } from "node:crypto";
import {
  buildWeixinMediaItem,
  buildWeixinUploadRequestBody,
  encodeWeixinMediaAesKey,
  encryptWeixinCdnMediaForTest,
  weixinCdnPaddedSize,
} from "../src/bots/providers/weixinProvider.js";
import { parseBotCommand } from "../src/bots/commandParser.js";
import { botAllowedCommandsSchema } from "@zcode/shared";
import { normalizeBotCommandPolicy } from "../src/bots/config.js";
import { isUserCommandAllowed } from "../src/bots/botConfigHelpers.js";
import {
  inferOutboundAttachmentKind,
  inferOutboundAttachmentMime,
  mergeWeixinContextTokens,
  resolveWorkspaceFilePath,
} from "../src/bots/botsService.js";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// specs/bot-file-delivery.md §5：出站媒体协议不变量（2026-09-29 生产环境实测）。

test("weixinCdnPaddedSize: PKCS7 补齐到 16 字节边界", () => {
  assert.equal(weixinCdnPaddedSize(0), 16);
  assert.equal(weixinCdnPaddedSize(1), 16);
  assert.equal(weixinCdnPaddedSize(15), 16);
  assert.equal(weixinCdnPaddedSize(16), 32);
  assert.equal(weixinCdnPaddedSize(70), 80);
  assert.equal(weixinCdnPaddedSize(93), 96);
  assert.equal(weixinCdnPaddedSize(1_048_576), 1_048_592);
});

test("协议不变量：aes_key 是 hex 字符串的 base64（双重编码），不是原始 key 的 base64", () => {
  const aesKeyHex = "00112233445566778899aabbccddeeff";
  const encoded = encodeWeixinMediaAesKey(aesKeyHex);
  assert.equal(encoded, Buffer.from(aesKeyHex, "utf8").toString("base64"));
  // 原始 16 字节 key 的 base64（错误形态）长度 24；正确形态长度 44。
  assert.equal(encoded.length, 44);
  assert.notEqual(encoded, Buffer.from(aesKeyHex, "hex").toString("base64"));
});

test("encryptWeixinCdnMediaForTest 与 AES-128-ECB 解密互逆", () => {
  const aesKeyHex = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
  const plaintext = Buffer.from("Zodex iLink outbound media probe payload", "utf8");
  const ciphertext = encryptWeixinCdnMediaForTest(plaintext, aesKeyHex);
  assert.equal(ciphertext.length, weixinCdnPaddedSize(plaintext.length));
  const key = Buffer.from(aesKeyHex, "hex");
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  assert.deepEqual(decrypted, plaintext);
});

test("parseBotCommand 解析 /file 与 /文件", () => {
  assert.deepEqual(parseBotCommand("/file reports/result.png"), {
    type: "file",
    value: "reports/result.png",
  });
  assert.deepEqual(parseBotCommand("/文件 报告.pdf"), { type: "file", value: "报告.pdf" });
  // 缺参数：不构成 file 命令，落到 unknown，由服务层回复帮助语义。
  assert.equal(parseBotCommand("/file").type, "unknown");
  // 前缀相同但更长的命令不受影响。
  assert.equal(parseBotCommand("/filesync a").type, "unknown");
});

test("inferOutboundAttachmentKind 按扩展名路由 image/video/file", () => {
  assert.equal(inferOutboundAttachmentKind("a.png"), "image");
  assert.equal(inferOutboundAttachmentKind("b.JPG"), "image");
  assert.equal(inferOutboundAttachmentKind("c.mp4"), "video");
  assert.equal(inferOutboundAttachmentKind("d.mov"), "video");
  assert.equal(inferOutboundAttachmentKind("report.pdf"), "file");
  assert.equal(inferOutboundAttachmentKind("archive.tar.gz"), "file");
});

test("inferOutboundAttachmentMime 已知扩展名映射，未知回退按 kind", () => {
  assert.equal(inferOutboundAttachmentMime("a.png", "image"), "image/png");
  assert.equal(inferOutboundAttachmentMime("a.md", "file"), "text/markdown");
  assert.equal(inferOutboundAttachmentMime("weird.xyz", "file"), "application/octet-stream");
  assert.equal(inferOutboundAttachmentMime("weird2", "image"), "image/jpeg");
});

test("resolveWorkspaceFilePath: workspace 树内文件解析成功并返回大小", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-bot-file-"));
  try {
    await writeFile(join(root, "result.txt"), "hello zodex");
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "image.png"), Buffer.from([1, 2, 3]));
    const direct = await resolveWorkspaceFilePath(root, "result.txt");
    assert.equal(direct.ok, true);
    if (direct.ok) {
      assert.equal(direct.sizeBytes, "hello zodex".length);
      assert.equal(direct.absolutePath, join(root, "result.txt"));
    }
    const nested = await resolveWorkspaceFilePath(root, "nested/image.png");
    assert.equal(nested.ok, true);
    const absoluteInside = await resolveWorkspaceFilePath(root, join(root, "result.txt"));
    assert.equal(absoluteInside.ok, true);
    // “..” 逃逸与绝对路径逃逸都必须拒绝。
    const escapeRelative = await resolveWorkspaceFilePath(root, "../outside.txt");
    assert.equal(escapeRelative.ok, false);
    if (!escapeRelative.ok) assert.equal(escapeRelative.reason, "outside");
    const escapeAbsolute = await resolveWorkspaceFilePath(
      root,
      join(tmpdir(), "zcode-elsewhere.txt"),
    );
    assert.equal(escapeAbsolute.ok, false);
    if (!escapeAbsolute.ok) assert.equal(escapeAbsolute.reason, "outside");
    const missing = await resolveWorkspaceFilePath(root, "no-such-file.bin");
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.reason, "missing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveWorkspaceFilePath: 目录与指向树外的符号链接均被拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-bot-file-symlink-"));
  try {
    const outsideRoot = await mkdtemp(join(tmpdir(), "zcode-bot-file-outside-"));
    try {
      await writeFile(join(outsideRoot, "secret.txt"), "secret");
      await mkdir(join(root, "sub"));
      await symlink(join(root, "sub"), join(root, "dir-link"), "dir");
      await symlink(join(outsideRoot, "secret.txt"), join(root, "escape-link"), "file");
      // 目录不是可发送文件。
      const directory = await resolveWorkspaceFilePath(root, "dir-link");
      assert.equal(directory.ok, false);
      // realpath 归一化后指向 workspace 之外的符号链接必须按 outside 拒绝。
      const symlinkEscape = await resolveWorkspaceFilePath(root, "escape-link");
      assert.equal(symlinkEscape.ok, false);
      if (!symlinkEscape.ok) assert.equal(symlinkEscape.reason, "outside");
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mergeWeixinContextTokens: 更新排序并裁剪到上限", () => {
  const initial = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [
      `peer-${index}`,
      { token: `token-${index}`, updatedAt: 1_000 + index },
    ]),
  );
  const merged = mergeWeixinContextTokens(initial, "peer-new", "token-new", 9_999);
  assert.equal(Object.keys(merged).length, 20);
  assert.deepEqual(merged["peer-new"], { token: "token-new", updatedAt: 9_999 });
  // 最旧的 peer-0 被裁掉。
  assert.equal(merged["peer-0"], undefined);
  // 既有 peer 更新时间戳后保留。
  const refreshed = mergeWeixinContextTokens(merged, "peer-5", "token-5b", 10_000);
  assert.equal(Object.keys(refreshed).length, 20);
  assert.deepEqual(refreshed["peer-5"], { token: "token-5b", updatedAt: 10_000 });
});

test("协议不变量：getuploadurl 请求体字段与实测线上形状一致", () => {
  const body = buildWeixinUploadRequestBody({
    filekey: "a".repeat(32),
    mediaType: 3,
    toUserId: "peer@im.wechat",
    rawSize: 93,
    rawFileMd5: "d41d8cd98f00b204e9800998ecf8427e",
    ciphertextSize: 96,
    aesKeyHex: "0".repeat(32),
  });
  assert.deepEqual(body, {
    filekey: "a".repeat(32),
    media_type: 3,
    to_user_id: "peer@im.wechat",
    rawsize: 93,
    rawfilemd5: "d41d8cd98f00b204e9800998ecf8427e",
    // filesize 是补齐后的密文大小，不是明文大小。
    filesize: 96,
    no_need_thumb: true,
    // aeskey 是 hex 字符串，不做 base64。
    aeskey: "0".repeat(32),
  });
});

test("协议不变量：媒体 item 形状（len 字符串明文大小；mid_size/video_size 密文大小；aes_key 双重编码）", () => {
  const base = {
    filename: "report.md",
    rawSize: 93,
    ciphertextSize: 96,
    downloadParam: "download-param-value",
    aesKeyHex: "ab".repeat(16),
  };
  const fileItem = buildWeixinMediaItem({ ...base, kind: "file" });
  assert.deepEqual(fileItem, {
    type: 4,
    file_item: {
      media: {
        encrypt_query_param: "download-param-value",
        aes_key: Buffer.from("ab".repeat(16), "utf8").toString("base64"),
        encrypt_type: 1,
      },
      file_name: "report.md",
      // len 必须是字符串形式的明文大小。
      len: "93",
    },
  });
  const imageItem = buildWeixinMediaItem({ ...base, kind: "image", filename: "shot.png" });
  assert.deepEqual(imageItem, {
    type: 2,
    image_item: {
      media: {
        encrypt_query_param: "download-param-value",
        aes_key: Buffer.from("ab".repeat(16), "utf8").toString("base64"),
        encrypt_type: 1,
      },
      // mid_size 是密文大小。
      mid_size: 96,
    },
  });
  const videoItem = buildWeixinMediaItem({ ...base, kind: "video", filename: "clip.mp4" });
  assert.deepEqual(videoItem, {
    type: 5,
    video_item: {
      media: {
        encrypt_query_param: "download-param-value",
        aes_key: Buffer.from("ab".repeat(16), "utf8").toString("base64"),
        encrypt_type: 1,
      },
      video_size: 96,
    },
  });
});

test("file 命令开关：schema 接受显式 false 且策略归一化不丢开关", () => {
  // botAllowedCommandsSchema 是 strict 的；缺了 file 字段时显式 false 会让整个配置解析失败。
  const parsed = botAllowedCommandsSchema.parse({
    status: true,
    new: true,
    workspace: true,
    model: true,
    thoughtLevel: true,
    reply: true,
    file: false,
  });
  assert.equal(parsed.file, false);
  const bot = {
    id: "bot-1",
    provider: "weixin",
    enabled: true,
    allowedCommands: normalizeBotCommandPolicy(parsed),
  } as Parameters<typeof isUserCommandAllowed>[0];
  assert.equal(isUserCommandAllowed(bot, "file"), false);
  assert.equal(isUserCommandAllowed(bot, "message"), true);
  // 缺省（未配置）视为允许。
  const defaultBot = {
    id: "bot-2",
    provider: "weixin",
    enabled: true,
    allowedCommands: normalizeBotCommandPolicy(),
  } as Parameters<typeof isUserCommandAllowed>[0];
  assert.equal(isUserCommandAllowed(defaultBot, "file"), true);
});
