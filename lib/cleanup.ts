import {
  deleteExpiredFileRecord,
  getExpiredFilesForCleanup,
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
      result.deleted += 1;
    } catch (error) {
      markFileDeletionFailed(
        file.token,
        error instanceof Error ? error.message : "Неизвестная ошибка удаления"
      );
      result.failed += 1;
    }
  }

  return result;
}
