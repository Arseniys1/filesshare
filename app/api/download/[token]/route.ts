import { NextRequest, NextResponse } from "next/server";
import { getFileByToken, releaseDownloadReservation, reserveDownload } from "@/lib/db";
import {
  getDownloadGrantCookieName,
  isSafeFileToken,
  verifyDownloadGrant,
} from "@/lib/download-grant";
import { decryptedStreamToWeb } from "@/lib/file-encryption";
import { getTelegramFile, streamTelegramFile } from "@/lib/telegram";
import { isExpired } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 600;

function contentDisposition(fileName: string): string {
  const fallback = fileName
    .replace(/[\r\n"\\]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_")
    .slice(0, 150) || "download";
  const encoded = encodeURIComponent(fileName).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  let reserved = false;
  let token = "";

  try {
    ({ token } = await params);
    if (!isSafeFileToken(token)) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    }
    const file = getFileByToken(token);
    if (!file) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    }
    if (isExpired(file.expires_at)) {
      return NextResponse.json({ error: "Срок действия ссылки истёк" }, { status: 410 });
    }

    if (file.password_hash) {
      const grant = request.cookies.get(getDownloadGrantCookieName(token))?.value;
      if (!verifyDownloadGrant(token, grant)) {
        return NextResponse.json(
          { error: "Требуется пароль", requiresPassword: true },
          { status: 401, headers: { "Cache-Control": "no-store" } }
        );
      }
    }

    if (!reserveDownload(token)) {
      return NextResponse.json({ error: "Достигнут лимит скачиваний" }, { status: 410 });
    }
    reserved = true;

    const telegramFile = await getTelegramFile(file.bot_token, file.telegram_file_id);
    if (!telegramFile.file_path) {
      throw new Error("Файл недоступен для скачивания");
    }
    const stream = await streamTelegramFile(file.bot_token, telegramFile.file_path);
    if (file.storage_encryption === "server-v1" && !file.storage_key_wrap) {
      throw new Error("У файла отсутствует ключ шифрования");
    }
    const body =
      file.storage_encryption === "server-v1"
        ? decryptedStreamToWeb(stream.body, file.storage_key_wrap!, file.content_size)
        : stream.body;
    const headers: Record<string, string> = {
      "Content-Type": file.mime_type,
      "Content-Disposition": contentDisposition(file.original_name),
      "Content-Length": file.content_size.toString(),
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    };
    if (file.content_encryption !== "none") {
      headers["X-File-Content-Encryption"] = file.content_encryption;
    }

    return new NextResponse(body as unknown as BodyInit, { headers });
  } catch (error) {
    if (reserved && token) releaseDownloadReservation(token);
    console.error("Download error:", error);
    return NextResponse.json({ error: "Ошибка при скачивании файла" }, { status: 500 });
  }
}
