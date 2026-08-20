import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUserNotificationSettings, updateUserNotificationSettings } from "@/lib/db";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  return NextResponse.json(getUserNotificationSettings(user.id));
}

export async function PATCH(request: NextRequest) {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  try {
    const body = await readJsonWithLimit<Record<string, unknown>>(request, 16 * 1024);
    const days = body.expiry_warning_days === undefined ? undefined : Number(body.expiry_warning_days);
    if (days !== undefined && (!Number.isSafeInteger(days) || days < 0 || days > 30)) throw new Error("Период предупреждения должен быть от 0 до 30 дней");
    const result = updateUserNotificationSettings(user.id, {
      email_enabled: body.email_enabled === undefined ? undefined : body.email_enabled ? 1 : 0,
      download_notifications: body.download_notifications === undefined ? undefined : body.download_notifications ? 1 : 0,
      summary_notifications: body.summary_notifications === undefined ? undefined : body.summary_notifications ? 1 : 0,
      expiry_warning_days: days,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка сохранения настроек" }, { status: 400 });
  }
}
