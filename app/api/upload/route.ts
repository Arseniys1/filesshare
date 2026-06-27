import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { getActiveStorageAccounts, createFileRecord } from "@/lib/db";
import { sendDocumentToChannel } from "@/lib/telegram";
import {
  getMaxFileSizeBytes,
  getMaxFileSizeLabel,
  isLocalTelegramApi,
} from "@/lib/telegram-config";
import {
  generateFileToken,
  computeExpiresAt,
  hashPassword,
} from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 600;

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-() \u0400-\u04FF]/g, "_") || "file";
}

export async function POST(request: NextRequest) {
  let tempDir: string | null = null;
  let tempPath: string | null = null;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const expiry = (formData.get("expiry") as string) || "never";
    const password = formData.get("password") as string | null;
    const maxDownloadsStr = formData.get("maxDownloads") as string | null;

    if (!file) {
      return NextResponse.json({ error: "Файл не выбран" }, { status: 400 });
    }

    const maxSize = getMaxFileSizeBytes();
    if (file.size > maxSize) {
      return NextResponse.json(
        {
          error: `Максимальный размер файла — ${getMaxFileSizeLabel()}${
            !isLocalTelegramApi()
              ? ". Для файлов до 2 ГБ настройте локальный Telegram Bot API (TELEGRAM_API_BASE в .env)"
              : ""
          }`,
        },
        { status: 400 }
      );
    }

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

    const account = accounts[0];
    const token = generateFileToken();
    const expiresAt = computeExpiresAt(expiry);
    const maxDownloads = maxDownloadsStr
      ? parseInt(maxDownloadsStr, 10)
      : null;

    const caption = [
      `📁 ${file.name}`,
      `🔗 Token: ${token}`,
      expiresAt ? `⏰ Expires: ${expiresAt}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    let message;

    if (isLocalTelegramApi() || file.size > 10 * 1024 * 1024) {
      tempDir = await mkdtemp(join(tmpdir(), "filesshare-"));
      tempPath = join(tempDir, sanitizeFileName(file.name));

      const webStream = file.stream();
      await pipeline(
        Readable.fromWeb(webStream as Parameters<typeof Readable.fromWeb>[0]),
        createWriteStream(tempPath)
      );

      message = await sendDocumentToChannel(
        account.bot_token,
        account.channel_id,
        { fileName: file.name, filePath: tempPath },
        caption
      );
    } else {
      const buffer = Buffer.from(await file.arrayBuffer());
      message = await sendDocumentToChannel(
        account.bot_token,
        account.channel_id,
        { fileName: file.name, buffer },
        caption
      );
    }

    if (!message.document) {
      return NextResponse.json(
        { error: "Не удалось загрузить файл в Telegram" },
        { status: 500 }
      );
    }

    const record = createFileRecord({
      token,
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      storageAccountId: account.id,
      telegramFileId: message.document.file_id,
      telegramMessageId: message.message_id,
      expiresAt,
      maxDownloads: maxDownloads && maxDownloads > 0 ? maxDownloads : null,
      passwordHash: password ? hashPassword(password) : null,
    });

    const baseUrl = request.nextUrl.origin;

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
        shareUrl: `${baseUrl}/f/${record.token}`,
        createdAt: record.created_at,
      },
    });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Ошибка при загрузке файла",
      },
      { status: 500 }
    );
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
