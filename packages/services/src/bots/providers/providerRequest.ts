const BOT_PROVIDER_REQUEST_TIMEOUT_MS = 15_000;

export interface BotProviderJsonResponse<T> {
  ok: boolean;
  status: number;
  payload: T | undefined;
  responseLogId?: string;
}

export interface BotProviderResponse {
  ok: boolean;
  status: number;
}

export interface BotProviderHeadResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
}

export type BotProviderFetch = typeof globalThis.fetch;

/**
 * Bot provider 的唯一出站请求器（specs/bot-provider-network.md F1）。
 * 三个有界 helper 全部闭包在注入的 fetchImpl 上；`fetch` 透出原始形态，
 * 供自带 deadline/响应体消费语义的下载路径使用（同样走注入出口，零裸 fetch）。
 */
export interface BotProviderRequester {
  fetch: BotProviderFetch;
  fetchBotProvider(
    input: string | URL | Request,
    init?: RequestInit,
    timeoutMs?: number,
  ): Promise<BotProviderResponse>;
  fetchBotProviderJson<T>(
    input: string | URL | Request,
    init?: RequestInit,
    timeoutMs?: number,
  ): Promise<BotProviderJsonResponse<T>>;
  fetchBotProviderWithHeaders(
    input: string | URL | Request,
    init?: RequestInit,
    timeoutMs?: number,
  ): Promise<BotProviderHeadResponse>;
}

/**
 * 修复原因：bot provider 网络此前直接使用 Node global fetch，忽略应用代理设置，
 * 在 GFW 网络下所有 Telegram 出站请求超时。requester 工厂让组合根注入
 * host API 网络 transport 的 fetch；缺省（undefined）时回落 globalThis.fetch，
 * 与既有直连行为逐字节一致（零漂移）。模块不保存任何模块级可变状态或单例。
 */
export function createBotProviderRequester(
  fetchImpl: BotProviderFetch = globalThis.fetch,
): BotProviderRequester {
  async function runBotProviderRequest<T>(
    input: string | URL | Request,
    init: RequestInit,
    timeoutMs: number,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const externalSignal = init.signal;
    const onAbort = (): void => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) {
      onAbort();
    } else {
      externalSignal?.addEventListener("abort", onAbort, { once: true });
    }
    const timeout = setTimeout(() => {
      controller.abort(new Error(`Bot provider request timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    try {
      const response = await fetchImpl(input, { ...init, signal: controller.signal });
      // 修复原因：收到响应头不代表请求完成。必须在同一个 AbortSignal 和 deadline 下
      // 消费响应体，否则服务端 headers 后停滞仍会永久堵住 Bot actor 队列。
      return await consume(response);
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * 第三方 Bot API 不一定会自行结束悬挂请求。所有回调 ACK 和出站消息都必须有界，
   * 否则单个请求会占住 actor 串行队列，后续权限、问答和计划审批都无法继续。
   */
  async function fetchBotProvider(
    input: string | URL | Request,
    init: RequestInit = {},
    timeoutMs = BOT_PROVIDER_REQUEST_TIMEOUT_MS,
  ): Promise<BotProviderResponse> {
    return runBotProviderRequest(input, init, timeoutMs, async (response) => {
      // Bugfix：fetch() 在响应头到达时就会完成，直接返回 Response 会提前撤销 deadline。
      // Telegram 调用方只需要状态，因此在受控 signal 下收完响应体后返回轻量结果。
      await response.arrayBuffer();
      return { ok: response.ok, status: response.status };
    });
  }

  async function fetchBotProviderJson<T>(
    input: string | URL | Request,
    init: RequestInit = {},
    timeoutMs = BOT_PROVIDER_REQUEST_TIMEOUT_MS,
  ): Promise<BotProviderJsonResponse<T>> {
    return runBotProviderRequest(input, init, timeoutMs, async (response) => {
      const text = await response.text();
      let payload: T | undefined;
      if (text) {
        try {
          payload = JSON.parse(text) as T;
        } catch (error) {
          if (response.ok) {
            throw error;
          }
        }
      }
      const responseLogId = response.headers.get("x-tt-logid") ?? undefined;
      return { ok: response.ok, status: response.status, payload, responseLogId };
    });
  }

  /**
   * 与 fetchBotProvider 相同的有界请求，但保留响应头。
   * 微信 CDN 上传的下载参数只存在于响应头 x-encrypted-param，无法用 JSON 消费路径读取。
   */
  async function fetchBotProviderWithHeaders(
    input: string | URL | Request,
    init: RequestInit = {},
    timeoutMs = BOT_PROVIDER_REQUEST_TIMEOUT_MS,
  ): Promise<BotProviderHeadResponse> {
    return runBotProviderRequest(input, init, timeoutMs, async (response) => {
      await response.arrayBuffer();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return { ok: response.ok, status: response.status, headers };
    });
  }

  return {
    fetch: fetchImpl,
    fetchBotProvider,
    fetchBotProviderJson,
    fetchBotProviderWithHeaders,
  };
}
