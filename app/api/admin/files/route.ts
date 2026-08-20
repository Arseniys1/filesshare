import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  createAdminAuditEvent,
  deleteAdminFileRecords,
  getAdminFileOverviewPage,
  getFileByToken,
  markFileDeletionFailed,
  markFileTelegramDeleted,
  setAdminFileRevoked,
} from "@/lib/db";
import { deleteTelegramMessage } from "@/lib/telegram";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const page = parsePaginationValue(request.nextUrl.searchParams.get("page"), 1);
  const limit = parsePaginationValue(request.nextUrl.searchParams.get("limit"), 20);
  const statusValue = request.nextUrl.searchParams.get("status");
  const status = statusValue === "active" || statusValue === "revoked" || statusValue === "expired" ? statusValue : undefined;
  const result = getAdminFileOverviewPage(request.nextUrl.searchParams.get("q") || undefined, page, limit, status);
  return NextResponse.json({ files: result.items, ...result });
}

function parsePaginationValue(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 10000);
}

export async function PATCH(request: NextRequest) {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  try {
    const body = await readJsonWithLimit<{ token?: unknown; action?: unknown }>(request, 16 * 1024);
    if (typeof body.token !== "string" || !body.token) {
      return NextResponse.json({ error: "Токен файла обязателен" }, { status: 400 });
    }
    if (body.action !== "revoke" && body.action !== "restore") {
      return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    }
    const revoked = body.action === "revoke";
    if (!setAdminFileRevoked(body.token, revoked)) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    }
    createAdminAuditEvent({
      adminUserId: user.id,
      action: revoked ? "revoke_file" : "restore_file",
      targetType: "file",
      targetId: body.token,
    });
    return NextResponse.json({ success: true, revoked });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка изменения файла" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Токен файла обязателен" }, { status: 400 });
  const file = getFileByToken(token);
  if (!file) return NextResponse.json({ error: "Файл не найден" }, { status: 404 });

  try {
    if (!file.telegram_deleted_at) {
      const deleted = await deleteTelegramMessage(file.bot_token, file.channel_id, file.telegram_message_id);
      if (!deleted) throw new Error(`Не удалось удалить файл «${file.original_name}» из Telegram`);
      markFileTelegramDeleted(file.token);
    }
    deleteAdminFileRecords(file.token);
    createAdminAuditEvent({
      adminUserId: user.id,
      action: "delete_file",
      targetType: "file",
      targetId: file.token,
      metadata: { fileName: file.original_name },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось удалить файл";
    markFileDeletionFailed(file.token, message);
    createAdminAuditEvent({
      adminUserId: user.id,
      action: "delete_file_failed",
      targetType: "file",
      targetId: file.token,
      metadata: { error: message },
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
