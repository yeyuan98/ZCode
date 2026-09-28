import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * 契约（specs/agent-identity-and-tooling-purge.md P4，Ruling 3）：
 *
 * `ModelRequestAuth` 惰性链整体删除：CLI 侧不再发起 interaction/requestProviderRuntimeHeaders，
 * 桌面协议随之移除该方法、取消通知与请求/响应 schema。协议 barrel 在 node --test 环境
 * 会连带加载 model-option-map 源码（strip-only 不支持参数属性），因此这里按本包既有
 * 源码扫描模式（见 updateFeedPolicy.test.ts）直接断言协议源文件不再包含任何
 * runtime-headers 方法/通知/schema 定义。
 */
test("zcode 协议不再暴露 provider runtime-headers 方法/通知/schema（P4 删除，源码扫描）", async () => {
  const protocolSource = await readFile(
    new URL("../src/zcode-protocol/index.ts", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    "interactionRequestProviderRuntimeHeaders",
    "providerRuntimeHeadersCancelled",
    "zcodeProviderRuntimeHeadersRequestParamsSchema",
    "zcodeProviderRuntimeHeadersRequestReasonSchema",
    "zcodeProviderRuntimeHeadersCancelledSchema",
    "zcodeProviderRuntimeHeadersResponseSchema",
  ]) {
    assert.equal(
      protocolSource.includes(forbidden),
      false,
      `${forbidden} 已随 ModelRequestAuth 链删除，不应再出现在协议源文件`,
    );
  }
});
