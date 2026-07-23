import Busboy from "busboy";
import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createFileRecord, getActiveStorageAccounts } from "@/lib/db";
import { sendDocumentToChannel } from "@/lib/telegram";
import {
  getMaxFileSizeBytes,
  getMaxFileSizeLabel,
  isLocalTelegramApi,
} from "@/lib/telegram-config";
import {
  computeExpiresAt,
  generateFileToken,
  hashPassword,
} from "@/lib/utils";
import {
  abandonUploadLease,
  acquireUploadLease,
  finishUploadLease,
  getClientIp,
  UploadRateLimitError,
} from "@/lib/upload-rate-limit";

export const runtime = "nodejs";
export const maxDuration = 600;

class UploadValidationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "UploadValidationError";
  }
}

interface ParsedUpload {
  fileName: string;
  mimeType: string;
  size: number;
  filePath: string;
  expiry: string;
  password: string | null;
  maxDownloads: number | null;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-() \u0400-\u04FF]/g, "_") || "file";
}

function normalizeFileName(name: string | undefined): string {
  return (name || "file").replace(/[\u0000-\u001F\u007F]/g, "_").slice(0, 255) || "file";
}

function parseMaxDownloads(value: string | undefined): number | null {
  if (!value) return null;
  if (!/^\d+$/.test(value)) {
    throw new UploadValidationError("Лимит скачиваний должен быть целым числом");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
    throw new UploadValidationError("Лимит скачиваний должен быть от 1 до 1 000 000");
  }
  return parsed;
}

async function parseMultipartUpload(
  request: NextRequest,
  tempDir: string,
  maxSize: number
): Promise<ParsedUpload> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
    throw new UploadValidationError("Ожидается multipart/form-data запрос");
  }
  if (!request.body) {
    throw new UploadValidationError("Тело запроса отсутствует");
  }

  const fields: Record<string, string> = {};
  let filePath: string | null = null;
  let fileName = "file";
  let mimeType = "application/octet-stream";
  let size = 0;
  let fileWrite: Promise<void> | null = null;
  let validationError: Error | null = null;

  const parser = Busboy({
    headers: { "content-type": contentType },
    limits: { files: 1, fields: 10, parts: 12, fileSize: maxSize },
  });
  const input = Readable.fromWeb(
    request.body as Parameters<typeof Readable.fromWeb>[0]
  );

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      input.destroy();
      reject(error);
    };

    parser.on("field", (name, value) => {
      if (["expiry", "password", "maxDownloads"].includes(name)) {
        fields[name] = value.slice(0, 2048);
      }
    });
    parser.on("file", (fieldName, stream, info) => {
      if (fieldName !== "file" || fileWrite) {
        validationError = new UploadValidationError("Передайте ровно один файл в поле file");
        stream.resume();
        return;
      }

      fileName = normalizeFileName(info.filename);
      mimeType = info.mimeType || "application/octet-stream";
      filePath = join(tempDir, sanitizeFileName(fileName));
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
      });
      stream.on("limit", () => {
        validationError = new UploadValidationError(
          `Максимальный размер файла — ${getMaxFileSizeLabel()}${
            !isLocalTelegramApi()
              ? ". Для файлов до 2 ГБ настройте локальный Telegram Bot API (TELEGRAM_API_BASE в .env)"
              : ""
          }`
        );
      });
      fileWrite = pipeline(stream, createWriteStream(filePath, { flags: "wx" }));
      fileWrite.catch(fail);
    });
    parser.on("filesLimit", () => {
      validationError = new UploadValidationError("Можно загрузить только один файл за запрос");
    });
    parser.on("fieldsLimit", () => {
      validationError = new UploadValidationError("Слишком много полей формы");
    });
    parser.on("partsLimit", () => {
      validationError = new UploadValidationError("Слишком много частей multipart-запроса");
    });
    parser.once("error", (error) =>
      fail(error instanceof Error ? error : new Error("Ошибка multipart-запроса"))
    );
    input.once("error", (error) =>
      fail(error instanceof Error ? error : new Error("Ошибка входящего потока"))
    );
    parser.once("close", async () => {
      try {
        await fileWrite;
        if (validationError) throw validationError;
        if (!filePath || !fileWrite) {
          throw new UploadValidationError("Файл не выбран");
        }
        if (size === 0) throw new UploadValidationError("Нельзя загрузить пустой файл");
        if (size > maxSize) {
          throw new UploadValidationError(`Максимальный размер файла — ${getMaxFileSizeLabel()}`);
        }
        if (fields.password && fields.password.length > 1024) {
          throw new UploadValidationError("Пароль слишком длинный");
        }
        if (!settled) {
          settled = true;
          resolve();
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Ошибка загрузки файла"));
      }
    });
    input.pipe(parser);
  });

  return {
    fileName,
    mimeType,
    size,
    filePath: filePath!,
    expiry: fields.expiry || "never",
    password: fields.password || null,
    maxDownloads: parseMaxDownloads(fields.maxDownloads),
  };
}

export async function POST(request: NextRequest) {
  let tempDir: string | null = null;
  let lease: ReturnType<typeof acquireUploadLease> | null = null;
  let leaseFinished = false;

  try {
    const accounts = getActiveStorageAccounts();
    if (accounts.length === 0) {
      return NextResponse.json(
        {
          error:
            "Нет настроенных аккаунтов хранения. Добавьте Telegram-бота в админ-панели.",
        },
        { status: 503 }
      );
    }

    const statedLength = Number(request.headers.get("content-length"));
    const expectedBytes =
      Number.isSafeInteger(statedLength) && statedLength > 0
        ? statedLength
        : getMaxFileSizeBytes();
    lease = acquireUploadLease(getClientIp(request.headers), expectedBytes);
    const uploadRoot = process.env.UPLOAD_TEMP_DIR?.trim() || tmpdir();
    await mkdir(uploadRoot, { recursive: true });
    tempDir = await mkdtemp(join(uploadRoot, "filesshare-"));

    const upload = await parseMultipartUpload(request, tempDir, getMaxFileSizeBytes());
    const account = accounts[0];
    const token = generateFileToken();
    const expiresAt = computeExpiresAt(upload.expiry);
    const caption = [
      `📁 ${upload.fileName}`,
      `🔗 Token: ${token}`,
      expiresAt ? `⏰ Expires: ${expiresAt}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const message = await sendDocumentToChannel(
      account.bot_token,
      account.channel_id,
      { fileName: upload.fileName, filePath: upload.filePath },
      caption
    );

    if (!message.document) {
      throw new Error("Не удалось загрузить файл в Telegram");
    }

    const record = createFileRecord({
      token,
      originalName: upload.fileName,
      mimeType: upload.mimeType,
      size: upload.size,
      storageAccountId: account.id,
      telegramFileId: message.document.file_id,
      telegramMessageId: message.message_id,
      expiresAt,
      maxDownloads: upload.maxDownloads,
      passwordHash: upload.password ? await hashPassword(upload.password) : null,
    });

    finishUploadLease(lease, upload.size);
    leaseFinished = true;

    return NextResponse.json({
      success: true,
      file: {
        token: record.token,
        name: record.original_name,
        size: record.size,
        mimeType: record.mime_type,
        expiresAt: record.expires_at,
        maxDownloads: record.max_downloads,
        hasPassword: !!record.password_hash,
        shareUrl: `${request.nextUrl.origin}/f/${record.token}`,
        createdAt: record.created_at,
      },
    });
  } catch (error) {
    if (error instanceof UploadRateLimitError) {
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { "Retry-After": error.retryAfterSeconds.toString() } }
      );
    }
    if (error instanceof UploadValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка при загрузке файла" },
      { status: 500 }
    );
  } finally {
    if (lease && !leaseFinished) abandonUploadLease(lease);
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
