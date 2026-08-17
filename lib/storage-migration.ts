import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  countLegacyStorageFiles,
  getLegacyStorageFiles,
  updateFileStorageEncryption,
} from "@/lib/db";
import { encryptFileToPath } from "@/lib/file-encryption";
import { getTelegramFile, deleteTelegramMessage, sendDocumentToChannel, streamTelegramFile } from "@/lib/telegram";

export interface StorageMigrationResult {
  found: number;
  migrated: number;
  failed: number;
  warnings: string[];
}

export async function encryptLegacyStorageFiles(options?: {
  limit?: number;
}): Promise<StorageMigrationResult> {
  const limit = Math.min(Math.max(options?.limit ?? 5, 1), 20);
  const files = getLegacyStorageFiles(limit);
  const result: StorageMigrationResult = {
    found: files.length,
    migrated: 0,
    failed: 0,
    warnings: [],
  };

  for (const file of files) {
    let workDir: string | null = null;
    let replacementMessage: { botToken: string; channelId: string; messageId: number } | null = null;

    try {
      const telegramFile = await getTelegramFile(file.bot_token, file.telegram_file_id);
      if (!telegramFile.file_path) throw new Error("Исходный файл недоступен в хранилище");

      const source = await streamTelegramFile(file.bot_token, telegramFile.file_path);
      const migrationRoot = process.env.UPLOAD_TEMP_DIR?.trim() || tmpdir();
      await mkdir(migrationRoot, { recursive: true });
      workDir = await mkdtemp(join(migrationRoot, "filesshare-reencrypt-"));
      const sourcePath = join(workDir, "legacy-source.bin");
      const encryptedPath = join(workDir, "storage-payload.bin");
      await pipeline(
        Readable.fromWeb(source.body),
        createWriteStream(sourcePath, { flags: "wx" })
      );

      const encrypted = await encryptFileToPath(sourcePath, encryptedPath);
      if (encrypted.originalSize !== file.content_size) {
        throw new Error("Размер исходного файла не совпадает с метаданными");
      }

      const replacement = await sendDocumentToChannel(
        file.bot_token,
        file.channel_id,
        { fileName: "storage-payload.bin", filePath: encryptedPath },
        `🔐 FileShare storage\n🔗 ${file.token}`
      );
      if (!replacement.document) throw new Error("Не удалось загрузить зашифрованную замену");
      replacementMessage = {
        botToken: file.bot_token,
        channelId: file.channel_id,
        messageId: replacement.message_id,
      };

      const updated = updateFileStorageEncryption({
        token: file.token,
        telegramFileId: replacement.document.file_id,
        telegramMessageId: replacement.message_id,
        storageKeyWrap: encrypted.storageKeyWrap,
      });
      if (!updated) throw new Error("Запись файла уже изменилась или не найдена");

      try {
        await deleteTelegramMessage(file.bot_token, file.channel_id, file.telegram_message_id);
      } catch (error) {
        result.warnings.push(
          `${file.token}: зашифрованная версия активна, но старое сообщение не удалено (${error instanceof Error ? error.message : "ошибка удаления"})`
        );
      }
      replacementMessage = null;
      result.migrated += 1;
    } catch (error) {
      result.failed += 1;
      if (replacementMessage) {
        await deleteTelegramMessage(
          replacementMessage.botToken,
          replacementMessage.channelId,
          replacementMessage.messageId
        ).catch(() => {});
      }
      result.warnings.push(
        `${file.token}: ${error instanceof Error ? error.message : "ошибка миграции"}`
      );
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return result;
}

export function getLegacyStorageStatus() {
  return { legacyFiles: countLegacyStorageFiles() };
}
