import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminAuditEvent, getAdminUsersPage, getUserById, updateUserAdminSettings } from "@/lib/db";

export const runtime = "nodejs";

function requireAdmin(request: NextRequest): NextResponse | null {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  return null;
}

function parseLimit(value: unknown, label: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} должен быть положительным числом`);
  return parsed;
}

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;
  const page = parsePaginationValue(request.nextUrl.searchParams.get("page"), 1);
  const limit = parsePaginationValue(request.nextUrl.searchParams.get("limit"), 20);
  const result = getAdminUsersPage(page, limit);
  return NextResponse.json({ users: result.items, ...result });
}

function parsePaginationValue(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 10000);
}

export async function PATCH(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;
  const current = getCurrentUser(request)!;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = Number(body.id);
    const target = getUserById(id);
    if (!target) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    if (id === current.id && (body.role !== undefined || body.blocked !== undefined)) return NextResponse.json({ error: "Нельзя изменить собственную роль или заблокировать себя" }, { status: 400 });
    const role = body.role === undefined ? undefined : body.role;
    if (role !== undefined && role !== "user" && role !== "admin") throw new Error("Некорректная роль");
    const data = {
      role: role as "user" | "admin" | undefined,
      blocked_at: body.blocked === undefined ? undefined : body.blocked ? new Date().toISOString() : null,
      max_file_size: parseLimit(body.maxFileSize, "Размер файла"),
      storage_limit: parseLimit(body.storageLimit, "Лимит хранилища"),
      active_link_limit: parseLimit(body.activeLinkLimit, "Лимит активных ссылок"),
      max_downloads: parseLimit(body.maxDownloads, "Лимит скачиваний"),
      max_parallel_uploads: parseLimit(body.maxParallelUploads, "Лимит параллельных загрузок"),
    };
    if (!updateUserAdminSettings(id, data)) return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
    createAdminAuditEvent({ adminUserId: current.id, action: "update_user_limits", targetType: "user", targetId: String(id), metadata: { role: data.role, blocked: data.blocked_at !== undefined, limitsChanged: true } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка изменения пользователя" }, { status: 400 });
  }
}
