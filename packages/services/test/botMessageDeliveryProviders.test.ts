import assert from "node:assert/strict";
import test from "node:test";
import type { BotConfig, BotOutboundMessage } from "@zcode/shared";
import { createWeixinBotProvider } from "../src/bots/providers/weixinProvider.js";
import { createTelegramBotProvider } from "../src/bots/providers/telegramProvider.js";
import { createFeishuBotProvider } from "../src/bots/providers/feishuProvider.js";
import { createBotProviderRequester } from "../src/bots/providers/providerRequest.js";

// specs/bot-provider-network.md「Amendment (3.14.5-alpha.1)」验收：
// F4 微信文本 /sendmessage 的 ret=-2 无 token 重试 + 显式 15s 超时；
// F6 Telegram Markdown 降级重发失败必须抛错（带两个状态）、Telegram/Feishu
// 凭据缺失必须显式抛错（不得静默返回谎报成功）。

interface CapturedFetchCall {
  url: string;
  init: RequestInit;
}

/** stub 全局 fetch 与 setTimeout（providerRequest 的显式 deadline 计数）。 */
function installProviderStub(respond: (call: CapturedFetchCall) => Response): {
  calls: CapturedFetchCall[];
  setTimeoutDelays: number[];
  restore(): void;
} {
  const calls: CapturedFetchCall[] = [];
  const setTimeoutDelays: number[] = [];
  const realFetch = globalThis.fetch;
  const realSetTimeout = globalThis.setTimeout.bind(globalThis) as (
    ...args: Parameters<typeof setTimeout>
  ) => ReturnType<typeof setTimeout>;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof globalThis.fetch;
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    setTimeoutDelays.push(typeof args[1] === "number" ? args[1] : 0);
    return realSetTimeout(...args);
  }) as typeof setTimeout;
  return {
    calls,
    setTimeoutDelays,
    restore() {
      globalThis.fetch = realFetch;
      globalThis.setTimeout = realSetTimeout;
    },
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildWeixinBot(): BotConfig {
  return {
    id: "bot-wx",
    name: "WeChat Bot",
    provider: "weixin",
    enabled: true,
    credentialRef: "weixin-token-ref",
    providerUserId: "wx-bot-self",
    allowedWorkspaces: ["*"],
    allowedCommands: {
      status: true,
      new: true,
      workspace: true,
      model: true,
      thoughtLevel: true,
      reply: true,
      file: true,
    },
    currentOptions: {},
    replyMode: "assistant_changes",
  };
}

function buildTelegramBot(): BotConfig {
  return {
    id: "bot-tg",
    name: "Telegram Bot",
    provider: "telegram",
    enabled: true,
    credentialRef: "tg-secret",
    allowedWorkspaces: ["*"],
    allowedCommands: {
      status: true,
      new: true,
      workspace: true,
      model: true,
      thoughtLevel: true,
      reply: true,
    },
    currentOptions: {},
    replyMode: "assistant_changes",
  };
}

function buildFeishuBot(): BotConfig {
  return {
    id: "bot-feishu",
    name: "Feishu Bot",
    provider: "feishu",
    enabled: true,
    feishuAppId: "cli_test",
    credentialRef: "feishu-secret",
    allowedWorkspaces: ["*"],
    allowedCommands: {
      status: true,
      new: true,
      workspace: true,
      model: true,
      thoughtLevel: true,
      reply: true,
    },
    currentOptions: {},
    replyMode: "streaming_card",
  };
}

function buildOutboundMessage(
  provider: BotConfig["provider"],
  overrides: { text?: string; providerContextToken?: string } = {},
): BotOutboundMessage {
  return {
    botId: `bot-${provider}`,
    provider,
    providerUserId: "peer-user-1",
    text: overrides.text ?? "hello from zodex",
    ...(overrides.providerContextToken
      ? { providerContextToken: overrides.providerContextToken }
      : {}),
  };
}

test("F4 微信文本 /sendmessage ret=-2：无 context_token 重试一次成功，显式 15s 超时", async () => {
  const stub = installProviderStub((call) => {
    assert.ok(call.url.endsWith("/ilink/bot/sendmessage"), `unexpected url: ${call.url}`);
    const body = JSON.parse(String(call.init.body)) as { msg?: { context_token?: string } };
    if (body.msg?.context_token) {
      // 携带过期 token 的首次尝试被协议拒绝（实测：token ~40min 失效）。
      return jsonResponse({ ret: -2, message: "prepare failed" });
    }
    return jsonResponse({ ret: 0 });
  });
  try {
    const provider = createWeixinBotProvider({
      loadCredential: async () => "wx-token-value",
      requester: createBotProviderRequester(),
    });
    // 修复前：文本发送无 ret=-2 重试——首次失败直接上抛，完成消息丢失。
    await provider.send(
      buildWeixinBot(),
      buildOutboundMessage("weixin", { providerContextToken: "token-expired" }),
    );
    assert.equal(stub.calls.length, 2, "ret=-2 必须触发一次无 token 重试");
    const [first, retry] = stub.calls;
    const firstBody = JSON.parse(String(first.init.body)) as { msg: { context_token?: string } };
    const retryBody = JSON.parse(String(retry.init.body)) as { msg: { context_token?: string } };
    assert.equal(firstBody.msg.context_token, "token-expired");
    assert.equal("context_token" in retryBody.msg, false, "重试不得再携带过期 token");
    // 文本 /sendmessage 与其它调用对齐：显式 15s deadline，不再是无界请求。
    assert.equal(stub.setTimeoutDelays[0], 15_000);
    assert.equal(stub.setTimeoutDelays[1], 15_000);
  } finally {
    stub.restore();
  }
});

test("F4 微信文本 ret=-2 重试后仍失败：如实上抛（不吞错）", async () => {
  const stub = installProviderStub(() => jsonResponse({ ret: -2, message: "prepare failed" }));
  try {
    const provider = createWeixinBotProvider({
      loadCredential: async () => "wx-token-value",
      requester: createBotProviderRequester(),
    });
    await assert.rejects(
      provider.send(
        buildWeixinBot(),
        buildOutboundMessage("weixin", { providerContextToken: "token-expired" }),
      ),
      /Weixin iLink \/sendmessage failed/u,
    );
    assert.equal(stub.calls.length, 2, "恰好一次重试，无重试风暴");
  } finally {
    stub.restore();
  }
});

test("F4 微信文本发送无 token 可退时直接请求（首次即无 context_token）", async () => {
  const stub = installProviderStub(() => jsonResponse({ ret: 0 }));
  try {
    const provider = createWeixinBotProvider({
      loadCredential: async () => "wx-token-value",
      requester: createBotProviderRequester(),
    });
    await provider.send(buildWeixinBot(), buildOutboundMessage("weixin"));
    assert.equal(stub.calls.length, 1);
    const body = JSON.parse(String(stub.calls[0].init.body)) as { msg: { context_token?: string } };
    assert.equal("context_token" in body.msg, false);
  } finally {
    stub.restore();
  }
});

test("F6 Telegram：Markdown 发送失败且纯文本降级也失败 → 抛错并携带两个状态", async () => {
  const stub = installProviderStub(() =>
    jsonResponse({ ok: false, description: "Bad Request: message text is empty" }, 400),
  );
  try {
    const provider = createTelegramBotProvider({
      loadCredential: async () => "tg-token-value",
      requester: createBotProviderRequester(),
    });
    // 修复前：降级重发的响应未检查——两次都失败仍静默返回，调用方误以为已送达。
    await assert.rejects(
      provider.send(buildTelegramBot(), buildOutboundMessage("telegram")),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /400/u);
        return /Telegram sendMessage failed/u.test(message) && /plain/u.test(message);
      },
    );
    assert.equal(stub.calls.length, 2, "恰好一次 Markdown + 一次纯文本降级");
  } finally {
    stub.restore();
  }
});

test("F6 Telegram：纯文本降级成功 → 不抛错", async () => {
  let callIndex = 0;
  const stub = installProviderStub(() => {
    callIndex += 1;
    return callIndex === 1
      ? jsonResponse({ ok: false, description: "Bad Request: can't parse entities" }, 400)
      : jsonResponse({ ok: true, result: { message_id: 7 } });
  });
  try {
    const provider = createTelegramBotProvider({
      loadCredential: async () => "tg-token-value",
      requester: createBotProviderRequester(),
    });
    await provider.send(
      buildTelegramBot(),
      buildOutboundMessage("telegram", { text: "broken _markdown [" }),
    );
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

test("F6 Telegram 凭据缺失：send 显式抛错（不得静默返回谎报成功）", async () => {
  const stub = installProviderStub(() => {
    throw new Error("unexpected fetch: credentials missing must not hit network");
  });
  try {
    const provider = createTelegramBotProvider({
      loadCredential: async () => null,
      requester: createBotProviderRequester(),
    });
    await assert.rejects(
      provider.send(buildTelegramBot(), buildOutboundMessage("telegram")),
      /Telegram bot token is missing/u,
    );
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("F6 Feishu 凭据缺失：send 显式抛错（不得静默返回谎报成功）", async () => {
  const stub = installProviderStub(() => {
    throw new Error("unexpected fetch: credentials missing must not hit network");
  });
  try {
    const provider = createFeishuBotProvider({
      loadCredential: async () => null,
      requester: createBotProviderRequester(),
    });
    await assert.rejects(
      provider.send(buildFeishuBot(), buildOutboundMessage("feishu")),
      /Feishu app credentials are missing/u,
    );
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});
