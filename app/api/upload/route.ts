import Busboy from "busboy";
import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { getActiveStorageAccounts, getUserById } from "@/lib/db";
import { getCurrentUserStatus } from "@/lib/auth";
import { type ContentEncryption } from "@/lib/file-encryption";
import {
  getMaxFileSizeBytes,
  getMaxFileSizeLabel,
  isLocalTelegramApi,
} from "@/lib/telegram-config";
import { persistUploadedFile } from "@/lib/upload-service";
import { validateUploadFileType } from "@/lib/file-validation";
import { EXPIRY_OPTIONS } from "@/lib/utils";
import {
  abandonUploadLease,
  acquireUploadLease,
  finishUploadLease,
  getClientIp,
  UploadRateLimitError,
} from "@/lib/upload-rate-limit";

export const runtime = "nodejs";
export const maxDuration = 600;

export class UploadValidationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export interface ParsedUpload {
  fileName: string;
  mimeType: string;
  size: number;
  contentSize: number;
  filePath: string;
  expiry: string;
  password: string | null;
  maxDownloads: number | null;
  contentEncryption: ContentEncryption;
  groupToken: string | null;
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

export async function parseMultipartUpload(
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
    limits: { files: 1, fields: 10, parts: 12, fileSize: maxSize + 256 * 1024 },
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
      if (["expiry", "password", "maxDownloads", "contentEncryption", "originalSize", "groupToken"].includes(name)) {
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
              ? ". Для файлов большего размера требуется расширенная конфигурация сервиса"
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
        const contentEncryption = fields.contentEncryption || "none";
        if (contentEncryption !== "none" && contentEncryption !== "e2ee-v1") {
          throw new UploadValidationError("Неизвестный режим шифрования содержимого");
        }
        let logicalSize = size;
        if (contentEncryption === "e2ee-v1") {
          if (!/^\d+$/.test(fields.originalSize || "")) {
            throw new UploadValidationError("Не указан исходный размер E2EE-файла");
          }
          logicalSize = Number(fields.originalSize);
          if (!Number.isSafeInteger(logicalSize) || logicalSize < 1) {
            throw new UploadValidationError("Некорректный исходный размер E2EE-файла");
          }
        }
        if (logicalSize > maxSize || size > maxSize) {
          throw new UploadValidationError(`Максимальный размер файла — ${getMaxFileSizeLabel()}`);
        }
        validateUploadFileType(fileName, mimeType);
        if (fields.expiry && !EXPIRY_OPTIONS.some((option) => option.value === fields.expiry)) {
          throw new UploadValidationError("Некорректный срок действия ссылки");
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
    size: fields.contentEncryption === "e2ee-v1" ? Number(fields.originalSize) : size,
    contentSize: size,
    filePath: filePath!,
    expiry: fields.expiry || "never",
    password: fields.password || null,
    maxDownloads: parseMaxDownloads(fields.maxDownloads),
    contentEncryption: (fields.contentEncryption || "none") as ContentEncryption,
    groupToken: fields.groupToken || null,
  };
}

export async function POST(request: NextRequest) {
  let tempDir: string | null = null;
  let lease: ReturnType<typeof acquireUploadLease> | null = null;
  let leaseFinished = false;

  try {
    const sessionStatus = getCurrentUserStatus(request);
    if (sessionStatus.blocked) {
      return NextResponse.json({ error: "Пользователь заблокирован" }, { status: 403 });
    }
    const user = sessionStatus.user;
    const accounts = getActiveStorageAccounts();
    if (accounts.length === 0) {
      return NextResponse.json(
        {
          error:
            "Сервис хранения пока не настроен. Обратитесь к администратору.",
        },
        { status: 503 }
      );
    }

    const statedLength = Number(request.headers.get("content-length"));
    const expectedBytes =
      Number.isSafeInteger(statedLength) && statedLength > 0
        ? statedLength
        : getMaxFileSizeBytes();
    const userRecord = user ? getUserById(user.id) : undefined;
    lease = acquireUploadLease(
      getClientIp(request.headers),
      expectedBytes,
      user?.id ?? null,
      userRecord?.max_parallel_uploads ?? null
    );
    const uploadRoot = process.env.UPLOAD_TEMP_DIR?.trim() || tmpdir();
    await mkdir(uploadRoot, { recursive: true });
    tempDir = await mkdtemp(join(uploadRoot, "filesshare-"));

    const upload = await parseMultipartUpload(request, tempDir, getMaxFileSizeBytes());
    const file = await persistUploadedFile({
      filePath: upload.filePath,
      tempDir,
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      size: upload.size,
      contentSize: upload.contentSize,
      expiry: upload.expiry,
      password: upload.password,
      maxDownloads: upload.maxDownloads,
      contentEncryption: upload.contentEncryption,
      groupToken: upload.groupToken,
      ownerUserId: user?.id ?? null,
      origin: request.nextUrl.origin,
    });

    finishUploadLease(lease, upload.contentSize);
    leaseFinished = true;

    return NextResponse.json({
      success: true,
      file,
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
