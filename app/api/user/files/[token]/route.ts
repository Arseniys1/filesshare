import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getCurrentUser } from "@/lib/auth";
import {
  deleteOwnedTransferRecords,
  deleteShortLink,
  enqueueNotification,
  getOwnedTransferDetails,
  getShortLinkByTargetToken,
  getUserById,
  getUserNotificationSettings,
  markFileDeletionFailed,
  markFileTelegramDeleted,
  setOwnedTransferRevoked,
  createShortLink,
  updateOwnedTransfer,
} from "@/lib/db";
import { deleteTelegramMessage } from "@/lib/telegram";
import { computeExpiresAt, EXPIRY_OPTIONS, hashPassword, isExpired } from "@/lib/utils";

export const runtime = "nodejs";

function parseMaxDownloads(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") throw new Error("Некорректный лимит скачиваний");
  const text = String(value);
  if (!/^\d+$/.test(text)) throw new Error("Лимит скачиваний должен быть целым числом");
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000_000) throw new Error("Лимит должен быть от 1 до 1 000 000");
  return parsed;
}

function parseExpiresAt(body: Record<string, unknown>): string | null | undefined {
  if (body.expiry !== undefined) {
    if (typeof body.expiry !== "string") throw new Error("Некорректный срок действия");
    if (body.expiry === "keep") return undefined;
    if (!EXPIRY_OPTIONS.some((option) => option.value === body.expiry)) throw new Error("Некорректный срок действия");
    return computeExpiresAt(body.expiry);
  }
  if (body.expiresAt === undefined) return undefined;
  if (body.expiresAt === null || body.expiresAt === "") return null;
  if (typeof body.expiresAt !== "string" || Number.isNaN(new Date(body.expiresAt).getTime())) throw new Error("Некорректная дата окончания");
  return new Date(body.expiresAt).toISOString();
}

async function getBody(request: NextRequest): Promise<Record<string, unknown>> {
  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Некорректное тело запроса");
  return body as Record<string, unknown>;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const { token } = await params;
  const details = getOwnedTransferDetails(user.id, token);
  if (!details) return NextResponse.json({ error: "Передача не найдена" }, { status: 404 });
  return NextResponse.json({
    kind: details.kind,
    token,
    shareUrl: `${request.nextUrl.origin}/f/${token}`,
    canRecreateLink: details.files.every((file) => file.content_encryption !== "e2ee-v1"),
    group: details.group ? {
      token: details.group.token,
      expiresAt: details.group.expires_at,
      downloadCount: details.group.download_count,
      maxDownloads: details.group.max_downloads,
      hasPassword: Boolean(details.group.password_hash),
      revoked: Boolean(details.group.revoked_at),
      createdAt: details.group.created_at,
    } : null,
    file: details.file ? {
      token: details.file.token,
      name: details.file.original_name,
      size: details.file.size,
      mimeType: details.file.mime_type,
      expiresAt: details.file.expires_at,
      downloadCount: details.file.download_count,
      maxDownloads: details.file.max_downloads,
      hasPassword: Boolean(details.file.password_hash),
      revoked: Boolean(details.file.revoked_at),
      createdAt: details.file.created_at,
      storageEncrypted: details.file.storage_encryption === "server-v1",
      contentEncryption: details.file.content_encryption,
    } : null,
    files: details.files.map((file) => ({
      token: file.token,
      name: file.original_name,
      size: file.size,
      mimeType: file.mime_type,
      downloadCount: file.download_count,
      storageEncrypted: file.storage_encryption === "server-v1",
      contentEncryption: file.content_encryption,
    })),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const { token } = await params;
  const details = getOwnedTransferDetails(user.id, token);
  if (!details) return NextResponse.json({ error: "Передача не найдена" }, { status: 404 });

  try {
    const body = await getBody(request);
    const expiresAt = parseExpiresAt(body);
    const maxDownloads = parseMaxDownloads(body.maxDownloads);
    const userRecord = getUserById(user.id);
    if (maxDownloads !== undefined && maxDownloads !== null && userRecord?.max_downloads && maxDownloads > userRecord.max_downloads) {
      return NextResponse.json({ error: "Лимит скачиваний превышает ограничение пользователя" }, { status: 400 });
    }
    if (maxDownloads !== undefined && maxDownloads !== null && maxDownloads < (details.group?.download_count ?? details.file?.download_count ?? 0)) {
      return NextResponse.json({ error: "Новый лимит меньше уже использованных скачиваний" }, { status: 400 });
    }
    let passwordHash: string | null | undefined;
    if (body.password !== undefined) {
      if (body.password !== null && typeof body.password !== "string") throw new Error("Некорректный пароль");
      if (typeof body.password === "string" && body.password.length > 1024) throw new Error("Пароль слишком длинный");
      passwordHash = body.password ? await hashPassword(body.password) : null;
    }
    if (expiresAt !== undefined && expiresAt !== null && isExpired(expiresAt)) {
      return NextResponse.json({ error: "Дата окончания уже прошла" }, { status: 400 });
    }
    if (expiresAt === undefined && maxDownloads === undefined && passwordHash === undefined) {
      return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
    }
    updateOwnedTransfer(user.id, token, { expiresAt, maxDownloads, passwordHash });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка обновления" }, { status: 400 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const { token } = await params;
  const action = request.nextUrl.searchParams.get("action");
  if (action === "short-link") {
    try {
      const shortLinkDetails = getOwnedTransferDetails(user.id, token);
      if (!shortLinkDetails) return NextResponse.json({ error: "Передача не найдена" }, { status: 404 });
      if (shortLinkDetails.files.some((file) => file.content_encryption === "e2ee-v1")) return NextResponse.json({ error: "Для E2EE-файла короткая ссылка без ключа невозможна" }, { status: 400 });
      let shortLink = getShortLinkByTargetToken(token);
      if (!shortLink) {
        const code = nanoid(8);
        try {
          createShortLink({ code, targetToken: token, ownerUserId: user.id });
          shortLink = { code, target_token: token, owner_user_id: user.id };
        } catch (error) {
          // Another request may have created the link between the lookup and insert.
          shortLink = getShortLinkByTargetToken(token);
          if (!shortLink) throw error;
        }
      }
      return NextResponse.json({ success: true, shortUrl: `${request.nextUrl.origin}/s/${shortLink.code}` });
    } catch {
      return NextResponse.json({ error: "Не удалось создать короткую ссылку" }, { status: 500 });
    }
  }
  if (action !== "revoke" && action !== "restore") return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  if (!setOwnedTransferRevoked(user.id, token, action === "revoke")) return NextResponse.json({ error: "Передача не найдена" }, { status: 404 });
  return NextResponse.json({ success: true, revoked: action === "revoke" });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const { token } = await params;
  const details = getOwnedTransferDetails(user.id, token);
  if (!details) return NextResponse.json({ error: "Передача не найдена" }, { status: 404 });
  try {
    for (const file of details.files) {
      if (file.telegram_deleted_at) continue;
      const deleted = await deleteTelegramMessage(file.bot_token, file.channel_id, file.telegram_message_id);
      if (!deleted) throw new Error(`Не удалось удалить файл «${file.original_name}» из Telegram`);
      markFileTelegramDeleted(file.token);
    }
  } catch (error) {
    for (const file of details.files) markFileDeletionFailed(file.token, error instanceof Error ? error.message : "Ошибка удаления из Telegram");
    if (getUserNotificationSettings(user.id).email_enabled) {
      enqueueNotification({
        userId: user.id,
        kind: "deletion_failed",
        dedupeKey: `manual-delete-failed:${token}:${Date.now()}`,
        payload: JSON.stringify({ fileName: details.kind === "group" ? `Пакет из ${details.files.length} файлов` : details.files[0]?.original_name, message: "Не удалось удалить все сообщения из Telegram. Повторите удаление позже." }),
      });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось удалить передачу" }, { status: 502 });
  }
  deleteShortLink(token);
  deleteOwnedTransferRecords(user.id, token);
  if (getUserNotificationSettings(user.id).email_enabled) {
    enqueueNotification({
      userId: user.id,
      kind: "deletion_completed",
      dedupeKey: `manual-delete:${token}`,
      payload: JSON.stringify({ fileName: details.kind === "group" ? `Пакет из ${details.files.length} файлов` : details.files[0]?.original_name, message: "Передача удалена из Telegram и FileShare." }),
    });
  }
  return NextResponse.json({ success: true });
}
