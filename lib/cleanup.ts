import {
  deleteExpiredFileRecord,
  enqueueNotification,
  getExpiredFilesForCleanup,
  getFilesNearExpiry,
  getUserNotificationSettings,
  markFileDeletionFailed,
} from "@/lib/db";
import { deleteTelegramMessage } from "@/lib/telegram";

export interface CleanupResult {
  found: number;
  deleted: number;
  failed: number;
  dryRun: boolean;
}

export async function cleanupExpiredFiles(options?: {
  dryRun?: boolean;
  limit?: number;
}): Promise<CleanupResult> {
  const dryRun = options?.dryRun ?? false;
  const files = getExpiredFilesForCleanup(options?.limit ?? 100);
  const result: CleanupResult = {
    found: files.length,
    deleted: 0,
    failed: 0,
    dryRun,
  };

  if (dryRun) return result;

  for (const file of files) {
    try {
      const deleted = await deleteTelegramMessage(
        file.bot_token,
        file.channel_id,
        file.telegram_message_id
      );
      if (!deleted) throw new Error("Telegram не подтвердил удаление сообщения");

      deleteExpiredFileRecord(file.token);
      if (file.owner_user_id && getUserNotificationSettings(file.owner_user_id).email_enabled) {
        enqueueNotification({
          userId: file.owner_user_id,
          kind: "transfer_expired",
          dedupeKey: `expired:${file.token}`,
          payload: JSON.stringify({ fileName: file.original_name, message: "Срок действия ссылки истёк, файл удалён из хранилища." }),
        });
      }
      result.deleted += 1;
    } catch (error) {
      markFileDeletionFailed(
        file.token,
        error instanceof Error ? error.message : "Неизвестная ошибка удаления"
      );
      if (file.owner_user_id && getUserNotificationSettings(file.owner_user_id).email_enabled) {
        enqueueNotification({
          userId: file.owner_user_id,
          kind: "deletion_failed",
          dedupeKey: `deletion-failed:${file.token}`,
          payload: JSON.stringify({ fileName: file.original_name, message: "FileShare не смог удалить файл из Telegram. Повторная попытка будет выполнена позже." }),
        });
      }
      result.failed += 1;
    }
  }

  return result;
}

export function enqueueExpiryWarnings(): number {
  let queued = 0;
  const files = getFilesNearExpiry();
  for (const file of files) {
    if (!file.owner_user_id) continue;
    const settings = getUserNotificationSettings(file.owner_user_id);
    if (!settings.email_enabled || settings.expiry_warning_days <= 0 || !file.expires_at) continue;
    const threshold = Date.now() + settings.expiry_warning_days * 24 * 60 * 60 * 1000;
    if (new Date(file.expires_at).getTime() > threshold) continue;
    if (enqueueNotification({
      userId: file.owner_user_id,
      kind: "expiry_warning",
      dedupeKey: `expiry:${file.token}:${file.expires_at.slice(0, 10)}`,
      payload: JSON.stringify({ fileName: file.original_name, expiresAt: file.expires_at, message: "Ссылка скоро перестанет работать." }),
    })) queued += 1;
  }
  return queued;
}
