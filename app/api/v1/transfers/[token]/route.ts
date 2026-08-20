import { NextRequest } from "next/server";
import {
  deleteOwnedTransferRecords,
  enqueueNotification,
  getOwnedTransferDetails,
  getUserById,
  getUserNotificationSettings,
  markFileDeletionFailed,
  markFileTelegramDeleted,
  updateOwnedTransfer,
} from "@/lib/db";
import { apiError, apiOk, parseJsonObject, requireApiKey } from "@/lib/api-v1";
import { deleteTelegramMessage } from "@/lib/telegram";
import { computeExpiresAt, EXPIRY_OPTIONS, hashPassword, isExpired } from "@/lib/utils";
import { mapTransferDetails } from "@/lib/user-api-transfer";
import { parseMaxDownloads } from "@/lib/user-api-input";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const runtime = "nodejs";

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

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const auth = requireApiKey(request);
  if (auth.response) return auth.response;
  const token = (await params).token;
  const details = getOwnedTransferDetails(auth.context.user.id, token);
  if (!details) return apiError("transfer_not_found", "Передача не найдена", 404);
  return apiOk(mapTransferDetails(details, request.nextUrl.origin));
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const auth = requireApiKey(request);
  if (auth.response) return auth.response;
  const token = (await params).token;
  const details = getOwnedTransferDetails(auth.context.user.id, token);
  if (!details) return apiError("transfer_not_found", "Передача не найдена", 404);
  try {
    const body = parseJsonObject(await readJsonWithLimit(request, 32 * 1024));
    const expiresAt = parseExpiresAt(body);
    const maxDownloads = body.maxDownloads === undefined ? undefined : parseMaxDownloads(body.maxDownloads);
    const user = getUserById(auth.context.user.id);
    if (maxDownloads !== undefined && maxDownloads !== null && user?.max_downloads && maxDownloads > user.max_downloads) return apiError("max_downloads_exceeded", "Лимит скачиваний превышает ограничение пользователя", 400);
    if (maxDownloads !== undefined && maxDownloads !== null && maxDownloads < (details.group?.download_count ?? details.file?.download_count ?? 0)) return apiError("max_downloads_below_usage", "Новый лимит меньше уже использованных скачиваний", 400);
    let passwordHash: string | null | undefined;
    if (body.password !== undefined) {
      if (body.password !== null && typeof body.password !== "string") throw new Error("Некорректный пароль");
      if (typeof body.password === "string" && body.password.length > 1024) throw new Error("Пароль слишком длинный");
      passwordHash = body.password ? await hashPassword(body.password) : null;
    }
    if (expiresAt !== undefined && expiresAt !== null && isExpired(expiresAt)) return apiError("expiry_in_past", "Дата окончания уже прошла", 400);
    if (expiresAt === undefined && maxDownloads === undefined && passwordHash === undefined) return apiError("no_changes", "Нет изменений", 400);
    updateOwnedTransfer(auth.context.user.id, token, { expiresAt, maxDownloads, passwordHash });
    return apiOk({ success: true });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return apiError("payload_too_large", error.message, 413);
    return apiError("invalid_request", error instanceof Error ? error.message : "Ошибка обновления", 400);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const auth = requireApiKey(request);
  if (auth.response) return auth.response;
  const token = (await params).token;
  const details = getOwnedTransferDetails(auth.context.user.id, token);
  if (!details) return apiError("transfer_not_found", "Передача не найдена", 404);
  try {
    for (const file of details.files) {
      if (file.telegram_deleted_at) continue;
      const deleted = await deleteTelegramMessage(file.bot_token, file.channel_id, file.telegram_message_id);
      if (!deleted) throw new Error(`Не удалось удалить файл «${file.original_name}» из Telegram`);
      markFileTelegramDeleted(file.token);
    }
  } catch (error) {
    for (const file of details.files) markFileDeletionFailed(file.token, error instanceof Error ? error.message : "Ошибка удаления из Telegram");
    if (getUserNotificationSettings(auth.context.user.id).email_enabled) {
      enqueueNotification({
        userId: auth.context.user.id,
        kind: "deletion_failed",
        dedupeKey: `api-delete-failed:${token}:${Date.now()}`,
        payload: JSON.stringify({ fileName: details.kind === "group" ? `Пакет из ${details.files.length} файлов` : details.files[0]?.original_name, message: "Не удалось удалить все сообщения из Telegram. Повторите удаление позже." }),
      });
    }
    return apiError("telegram_delete_failed", error instanceof Error ? error.message : "Не удалось удалить передачу", 502);
  }
  deleteOwnedTransferRecords(auth.context.user.id, token);
  if (getUserNotificationSettings(auth.context.user.id).email_enabled) {
    enqueueNotification({
      userId: auth.context.user.id,
      kind: "deletion_completed",
      dedupeKey: `api-delete:${token}`,
      payload: JSON.stringify({ fileName: details.kind === "group" ? `Пакет из ${details.files.length} файлов` : details.files[0]?.original_name, message: "Передача удалена из Telegram и FileShare." }),
    });
  }
  return apiOk({ success: true });
}
