import FormData from "form-data";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  buildBotApiUrl,
  buildFileApiUrl,
  isLocalTelegramApi,
  toTelegramFileUri,
} from "./telegram-config";
import { telegramFetch } from "./telegram-fetch";
import { postForm, postJson } from "./telegram-http";

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  document?: TelegramDocument;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_path?: string;
  file_size?: number;
}

class TelegramAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public retryAfter?: number
  ) {
    super(message);
    this.name = "TelegramAPIError";
  }
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    throw new TelegramAPIError(
      `Telegram вернул пустой ответ (HTTP ${response.status})`,
      response.status
    );
  }

  try {
    return JSON.parse(text) as {
      ok: boolean;
      result?: unknown;
      description?: string;
      parameters?: { retry_after?: number };
    };
  } catch {
    throw new TelegramAPIError(
      `Telegram вернул не JSON: ${text.slice(0, 200)}`,
      response.status
    );
  }
}

async function callTelegramJson<T>(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
  timeoutMs = 30000
): Promise<T> {
  const url = buildBotApiUrl(botToken, method);

  try {
    const response = await telegramFetch(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      timeoutMs
    );

    const data = await parseJsonResponse(response);

    if (!data.ok) {
      throw new TelegramAPIError(
        data.description || "Telegram API error",
        response.status,
        data.parameters?.retry_after
      );
    }

    return data.result as T;
  } catch (err) {
    if (err instanceof TelegramAPIError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new TelegramAPIError("Telegram API не отвечает. Проверьте VPN.", 408);
    }
    throw new TelegramAPIError(
      err instanceof Error ? err.message : "Ошибка Telegram API",
      503
    );
  }
}

export async function sendDocumentToChannel(
  botToken: string,
  channelId: string,
  options: {
    fileName: string;
    buffer?: Buffer;
    filePath?: string;
  },
  caption?: string
): Promise<TelegramMessage> {
  const url = buildBotApiUrl(botToken, "sendDocument");
  const timeoutMs = isLocalTelegramApi() ? 600000 : 120000;

  try {
    if (isLocalTelegramApi() && options.filePath) {
      return await postJson<TelegramMessage>(
        url,
        {
          chat_id: channelId,
          document: toTelegramFileUri(options.filePath),
          disable_notification: true,
          ...(caption ? { caption: caption.slice(0, 1024) } : {}),
        },
        timeoutMs
      );
    }

    const document =
      options.buffer ??
      (options.filePath ? createReadStream(options.filePath) : undefined);

    if (!document) {
      throw new TelegramAPIError("Нет данных файла для отправки", 400);
    }

    const form = new FormData();
    form.append("chat_id", channelId);
    form.append("document", document, {
      filename: options.fileName,
      contentType: "application/octet-stream",
    });
    form.append("disable_notification", "true");

    if (caption) {
      form.append("caption", caption.slice(0, 1024));
    }

    return await postForm<TelegramMessage>(url, form, timeoutMs);
  } catch (err) {
    throw new TelegramAPIError(
      err instanceof Error ? err.message : "Ошибка загрузки файла",
      400
    );
  }
}

export async function getTelegramFile(
  botToken: string,
  fileId: string
): Promise<TelegramFile> {
  return callTelegramJson<TelegramFile>(botToken, "getFile", { file_id: fileId });
}

export interface TelegramFileStream {
  body: NodeReadableStream<Uint8Array>;
  contentLength?: string;
}

export async function streamTelegramFile(
  botToken: string,
  filePath: string
): Promise<TelegramFileStream> {
  if (isLocalTelegramApi() && path.isAbsolute(filePath)) {
    await access(filePath);
    return {
      body: Readable.toWeb(createReadStream(filePath)) as NodeReadableStream<Uint8Array>,
    };
  }

  const url = buildFileApiUrl(botToken, filePath);
  const response = await telegramFetch(url, {}, 600000);

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error("Telegram вернул пустой поток файла");
  }

  return {
    body: response.body as unknown as NodeReadableStream<Uint8Array>,
    contentLength: response.headers.get("content-length") || undefined,
  };
}

export async function deleteTelegramMessage(
  botToken: string,
  channelId: string,
  messageId: number
): Promise<boolean> {
  return callTelegramJson<boolean>(botToken, "deleteMessage", {
    chat_id: channelId,
    message_id: messageId,
  });
}

export async function testBotConnection(
  botToken: string,
  channelId: string
): Promise<{ ok: boolean; botName?: string; error?: string }> {
  try {
    const me = await callTelegramJson<{ first_name: string; username?: string }>(
      botToken,
      "getMe",
      {}
    );

    await callTelegramJson(botToken, "getChat", { chat_id: channelId });

    return {
      ok: true,
      botName: me.username ? `@${me.username}` : me.first_name,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export { TelegramAPIError };
