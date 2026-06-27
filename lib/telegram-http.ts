import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import FormData from "form-data";
import { HttpsProxyAgent } from "https-proxy-agent";

interface TelegramResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

function getProxyAgent(parsed: URL): HttpsProxyAgent<string> | undefined {
  const proxyUrl = process.env.TELEGRAM_PROXY?.trim();
  if (!proxyUrl || parsed.protocol === "http:") return undefined;
  return new HttpsProxyAgent(proxyUrl);
}

function readResponse(
  res: import("node:http").IncomingMessage
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    res.on("error", reject);
  });
}

function parseTelegramResponse<T>(
  text: string,
  statusCode?: number
): T {
  if (!text) {
    throw new Error(`Telegram вернул пустой ответ (HTTP ${statusCode ?? "?"})`);
  }

  let data: TelegramResponse<T>;
  try {
    data = JSON.parse(text) as TelegramResponse<T>;
  } catch {
    throw new Error(
      `Telegram вернул не JSON (HTTP ${statusCode}): ${text.slice(0, 200)}`
    );
  }

  if (!data.ok) {
    throw new Error(data.description || `Telegram error ${data.error_code}`);
  }

  return data.result as T;
}

function requestRaw(
  url: string,
  options: {
    headers: Record<string, string | number>;
    body?: FormData | string;
    timeoutMs: number;
  }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? https : http;
    const agent = isHttps ? getProxyAgent(parsed) : undefined;

    const send = (headers: Record<string, string | number>, body?: FormData | string) => {
      const req = transport.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: "POST",
          headers,
          agent,
          timeout: options.timeoutMs,
        },
        async (res) => {
          try {
            const text = await readResponse(res);
            resolve(text);
          } catch (err) {
            reject(err);
          }
        }
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Таймаут запроса к Telegram"));
      });

      if (body instanceof FormData) {
        body.pipe(req);
      } else if (body) {
        req.write(body);
        req.end();
      } else {
        req.end();
      }
    };

    if (options.body instanceof FormData) {
      options.body.getLength((err, length) => {
        if (err) {
          reject(err);
          return;
        }
        send(
          { ...options.headers, "Content-Length": length },
          options.body
        );
      });
    } else {
      send(options.headers, options.body);
    }
  });
}

export function postJson<T>(
  url: string,
  payload: Record<string, unknown>,
  timeoutMs = 120000
): Promise<T> {
  const body = JSON.stringify(payload);
  return requestRaw(url, {
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
    body,
    timeoutMs,
  }).then((text) => parseTelegramResponse<T>(text));
}

export function postForm<T>(
  url: string,
  form: FormData,
  timeoutMs = 120000
): Promise<T> {
  return requestRaw(url, {
    headers: form.getHeaders() as Record<string, string>,
    body: form,
    timeoutMs,
  }).then((text) => parseTelegramResponse<T>(text));
}
