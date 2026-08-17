import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  createDownloadEvent,
  getFileByToken,
  enqueueNotification,
  getFileGroupById,
  getUserNotificationSettings,
  releaseDownloadReservation,
  releaseGroupDownload,
  reserveDownload,
  reserveGroupDownload,
} from "@/lib/db";
import {
  getDownloadGrantCookieName,
  isSafeFileToken,
  RECIPIENT_COOKIE_NAME,
  verifyDownloadGrant,
} from "@/lib/download-grant";
import { decryptedStreamToWeb } from "@/lib/file-encryption";
import { getTelegramFile, streamTelegramFile } from "@/lib/telegram";
import { isExpired } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 600;

function hashClientIp(request: NextRequest): string | null {
  const forwarded = process.env.TRUST_PROXY === "1" ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  const ip = forwarded || "direct";
  if (!ip) return null;
  return crypto
    .createHash("sha256")
    .update(`${process.env.DOWNLOAD_GRANT_SECRET || "filesshare"}:${ip}`)
    .digest("hex");
}

function recipientHash(request: NextRequest, token: string): string {
  const value = request.cookies.get(RECIPIENT_COOKIE_NAME)?.value || hashClientIp(request) || request.headers.get("user-agent") || "direct";
  return crypto.createHash("sha256").update(`${process.env.DOWNLOAD_GRANT_SECRET || "filesshare"}:recipient:${token}:${value}`).digest("hex");
}

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

function throttleStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const bytesPerSecond = Number(process.env.DOWNLOAD_BYTES_PER_SECOND || "0");
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return body;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      await new Promise((resolve) => setTimeout(resolve, Math.ceil((chunk.byteLength / bytesPerSecond) * 1000)));
      controller.enqueue(chunk);
    },
  }));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  let reserved = false;
  let token = "";
  let reservationToken = "";
  let groupReservation = false;
  let downloadedFile: ReturnType<typeof getFileByToken>;
  let eventRecorded = false;

  try {
    ({ token } = await params);
    if (!isSafeFileToken(token)) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    }
    const file = getFileByToken(token);
    if (!file) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    }
    const group = file.group_id !== null ? getFileGroupById(file.group_id) : undefined;
    if (group && group.revoked_at) {
      return NextResponse.json({ error: "Ссылка отозвана" }, { status: 410 });
    }
    if (file.revoked_at) {
      return NextResponse.json({ error: "Ссылка отозвана" }, { status: 410 });
    }
    if (group && isExpired(group.expires_at)) {
      return NextResponse.json({ error: "Срок действия ссылки истёк" }, { status: 410 });
    }
    if (!group && isExpired(file.expires_at)) {
      return NextResponse.json({ error: "Срок действия ссылки истёк" }, { status: 410 });
    }

    if (group ? (group.password_hash || group.pin_hash) : (file.password_hash || file.pin_hash)) {
      const grantToken = group?.token ?? token;
      const grant = request.cookies.get(getDownloadGrantCookieName(grantToken))?.value;
      if (!verifyDownloadGrant(grantToken, grant)) {
        return NextResponse.json(
          { error: "Требуется пароль", requiresPassword: true },
          { status: 401, headers: { "Cache-Control": "no-store" } }
        );
      }
    }

    const recipient = recipientHash(request, group?.token ?? token);
    if (group ? !reserveGroupDownload(group.token, recipient) : !reserveDownload(token, recipient)) {
      return NextResponse.json({ error: "Достигнут лимит скачиваний" }, { status: 410 });
    }
    reserved = true;
    reservationToken = group?.token ?? token;
    groupReservation = !!group;
    downloadedFile = file;
    createDownloadEvent({
      fileId: file.id,
      groupId: group?.id ?? null,
      outcome: "started",
      ipHash: hashClientIp(request),
      userAgent: request.headers.get("user-agent")?.slice(0, 512) || null,
      isGroupDownload: Boolean(group),
    });
    eventRecorded = true;
    const notificationSettings = file.owner_user_id ? getUserNotificationSettings(file.owner_user_id) : null;
    if (file.owner_user_id && notificationSettings?.email_enabled && (notificationSettings.download_notifications || notificationSettings.summary_notifications)) {
      enqueueNotification({
        userId: file.owner_user_id,
        kind: "file_downloaded",
        dedupeKey: notificationSettings.summary_notifications
          ? `download-summary:${file.owner_user_id}:${new Date().toISOString().slice(0, 13)}`
          : `download:${file.id}:${new Date().toISOString().slice(0, 13)}`,
        payload: JSON.stringify({
          fileName: file.original_name,
          downloads: group?.download_count ?? file.download_count,
          message: "Файл был скачан.",
        }),
      });
    }

    const telegramFile = await getTelegramFile(file.bot_token, file.telegram_file_id);
    if (!telegramFile.file_path) {
      throw new Error("Файл недоступен для скачивания");
    }
    const stream = await streamTelegramFile(file.bot_token, telegramFile.file_path);
    if (file.storage_encryption === "server-v1" && !file.storage_key_wrap) {
      throw new Error("У файла отсутствует ключ шифрования");
    }
    const decryptedBody =
      file.storage_encryption === "server-v1"
        ? decryptedStreamToWeb(stream.body, file.storage_key_wrap!, file.content_size)
        : stream.body;
    const body = throttleStream(decryptedBody as unknown as ReadableStream<Uint8Array>);
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
    if (reserved && reservationToken) {
      if (groupReservation) releaseGroupDownload(reservationToken);
      else releaseDownloadReservation(reservationToken);
    }
    if (eventRecorded && downloadedFile) {
      createDownloadEvent({
        fileId: downloadedFile.id,
        groupId: downloadedFile.group_id,
        outcome: "failed",
        ipHash: hashClientIp(request),
        userAgent: request.headers.get("user-agent")?.slice(0, 512) || null,
        isGroupDownload: downloadedFile.group_id !== null,
      });
    }
    console.error("Download error:", error);
    return NextResponse.json({ error: "Ошибка при скачивании файла" }, { status: 500 });
  }
}
