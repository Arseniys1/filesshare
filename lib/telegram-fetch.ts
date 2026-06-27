import {
  fetch as undiciFetch,
  ProxyAgent,
  type Dispatcher,
  type RequestInit as UndiciRequestInit,
  type FormData as UndiciFormData,
} from "undici";

let cachedDispatcher: Dispatcher | undefined | null = null;
let proxyDisabled = false;

function getProxyUrl(): string | undefined {
  if (proxyDisabled) return undefined;
  return process.env.TELEGRAM_PROXY?.trim() || undefined;
}

function getProxyDispatcher(): Dispatcher | undefined {
  if (cachedDispatcher !== null) {
    return cachedDispatcher || undefined;
  }

  const proxyUrl = getProxyUrl();
  if (!proxyUrl) {
    cachedDispatcher = undefined;
    return undefined;
  }

  try {
    cachedDispatcher = new ProxyAgent(proxyUrl);
    console.log(
      `[telegram] proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`
    );
    return cachedDispatcher;
  } catch (err) {
    console.error("[telegram] invalid proxy URL:", err);
    cachedDispatcher = undefined;
    return undefined;
  }
}

function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    err.name === "AbortError" ||
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("connect") ||
    msg.includes("socket")
  );
}

async function doFetch(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  dispatcher?: Dispatcher
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const options: UndiciRequestInit = {
      method: init?.method ?? "GET",
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    };

    if (init?.body) {
      options.body = init.body as UndiciRequestInit["body"] | UndiciFormData;
    }
    if (init?.headers) {
      options.headers = init.headers as UndiciRequestInit["headers"];
    }

    return (await undiciFetch(url, options)) as unknown as Response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function telegramFetch(
  url: string,
  init?: RequestInit,
  timeoutMs = 15000
): Promise<Response> {
  const dispatcher = getProxyDispatcher();

  if (!dispatcher) {
    return doFetch(url, init, timeoutMs);
  }

  try {
    return await doFetch(url, init, timeoutMs, dispatcher);
  } catch (err) {
    if (!isConnectionError(err)) throw err;

    console.warn(
      "[telegram] proxy failed, retrying direct (TUN VPN should handle this)"
    );
    proxyDisabled = true;
    cachedDispatcher = undefined;

    return doFetch(url, init, timeoutMs);
  }
}

export function isProxyConfigured(): boolean {
  return !!getProxyUrl() && !proxyDisabled;
}
