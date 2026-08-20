import { NextRequest } from "next/server";
import { getUserNotificationSettings, updateUserNotificationSettings } from "@/lib/db";
import { apiError, apiOk, parseJsonObject, requireApiKey } from "@/lib/api-v1";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const runtime = "nodejs";

function mapSettings(settings: ReturnType<typeof getUserNotificationSettings>) {
  return {
    emailEnabled: Boolean(settings.email_enabled),
    downloadNotifications: Boolean(settings.download_notifications),
    summaryNotifications: Boolean(settings.summary_notifications),
    expiryWarningDays: settings.expiry_warning_days,
  };
}

export function GET(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth.response) return auth.response;
  return apiOk(mapSettings(getUserNotificationSettings(auth.context.user.id)));
}

export async function PATCH(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth.response) return auth.response;
  try {
    const body = parseJsonObject(await readJsonWithLimit(request, 16 * 1024));
    const days = body.expiryWarningDays === undefined ? undefined : Number(body.expiryWarningDays);
    if (days !== undefined && (!Number.isSafeInteger(days) || days < 0 || days > 30)) {
      return apiError("invalid_expiry_warning_days", "Период предупреждения должен быть от 0 до 30 дней", 400);
    }
    const result = updateUserNotificationSettings(auth.context.user.id, {
      email_enabled: body.emailEnabled === undefined ? undefined : body.emailEnabled ? 1 : 0,
      download_notifications: body.downloadNotifications === undefined ? undefined : body.downloadNotifications ? 1 : 0,
      summary_notifications: body.summaryNotifications === undefined ? undefined : body.summaryNotifications ? 1 : 0,
      expiry_warning_days: days,
    });
    return apiOk(mapSettings(result));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return apiError("payload_too_large", error.message, 413);
    return apiError("invalid_request", error instanceof Error ? error.message : "Ошибка сохранения настроек", 400);
  }
}
