import { join } from "node:path";
import { createFileRecord, enqueueNotification, getActiveStorageAccounts, getFileGroupByToken, getUserById, getUserNotificationSettings, getUserQuotaUsage } from "@/lib/db";
import { encryptFileToPath, type ContentEncryption } from "@/lib/file-encryption";
import { sendDocumentToChannel } from "@/lib/telegram";
import { scanUploadedFile } from "@/lib/antivirus";
import { computeExpiresAt, generateFileToken, hashPassword } from "@/lib/utils";

export interface PersistUploadInput {
  filePath: string;
  tempDir: string;
  fileName: string;
  mimeType: string;
  size: number;
  contentSize: number;
  expiry: string;
  expiresAt?: string | null;
  password: string | null;
  passwordHash?: string | null;
  maxDownloads: number | null;
  contentEncryption: ContentEncryption;
  groupToken: string | null;
  ownerUserId: number | null;
  origin: string;
}

export async function persistUploadedFile(input: PersistUploadInput) {
  const accounts = getActiveStorageAccounts();
  if (accounts.length === 0) throw new Error("Сервис хранения пока не настроен. Обратитесь к администратору.");
  const group = input.groupToken ? getFileGroupByToken(input.groupToken) : null;
  if (input.groupToken && !group) throw new Error("Группа файлов не найдена");
  if (group?.owner_user_id !== null && group?.owner_user_id !== undefined && group.owner_user_id !== input.ownerUserId) {
    throw new Error("Нет доступа к группе файлов");
  }
  const ownerUserId = group ? group.owner_user_id : input.ownerUserId;
  const owner = ownerUserId ? getUserById(ownerUserId) : undefined;
  if (owner?.blocked_at) throw new Error("Пользователь заблокирован");
  if (owner?.max_file_size && input.size > owner.max_file_size) throw new Error("Файл превышает индивидуальный лимит пользователя");
  if (owner?.max_downloads && input.maxDownloads !== null && input.maxDownloads > owner.max_downloads) throw new Error("Лимит скачиваний превышает ограничение пользователя");
  if (owner?.storage_limit) {
    const usage = getUserQuotaUsage(ownerUserId!);
    if (usage.storageUsed + input.size > owner.storage_limit) throw new Error("Превышен общий лимит хранилища пользователя");
  }
  if (owner?.active_link_limit && !group) {
    const usage = getUserQuotaUsage(ownerUserId!);
    if (usage.activeLinks >= owner.active_link_limit) throw new Error("Превышен лимит активных ссылок пользователя");
  }
  const account = accounts[0];
  const token = generateFileToken();
  const expiresAt = group ? group.expires_at : input.expiresAt !== undefined ? input.expiresAt : computeExpiresAt(input.expiry);
  const encryptedPath = join(input.tempDir, "storage-payload.bin");
  await scanUploadedFile(input.filePath, input.contentEncryption);
  const encryptedFile = await encryptFileToPath(input.filePath, encryptedPath);
  if (encryptedFile.originalSize !== input.contentSize) throw new Error("Размер файла изменился во время шифрования");

  const caption = [
    "🔐 FileShare storage",
    `🔗 ${token}`,
    expiresAt ? `⏰ Expires: ${expiresAt}` : "",
  ].filter(Boolean).join("\n");
  const message = await sendDocumentToChannel(account.bot_token, account.channel_id, { fileName: "storage-payload.bin", filePath: encryptedPath }, caption);
  if (!message.document) throw new Error("Не удалось сохранить файл в хранилище");

  const effectiveMaxDownloads = group
    ? group.max_downloads
    : input.maxDownloads ?? owner?.max_downloads ?? null;
  const record = createFileRecord({
    token,
    originalName: input.fileName,
    mimeType: input.mimeType,
    size: input.size,
    contentSize: input.contentSize,
    storageAccountId: account.id,
    telegramFileId: message.document.file_id,
    telegramMessageId: message.message_id,
    expiresAt,
    maxDownloads: effectiveMaxDownloads,
    passwordHash: group ? group.password_hash : input.passwordHash !== undefined ? input.passwordHash : input.password ? await hashPassword(input.password) : null,
    storageEncryption: encryptedFile.storageEncryption,
    storageKeyWrap: encryptedFile.storageKeyWrap,
    contentEncryption: input.contentEncryption,
    groupId: group?.id ?? null,
    ownerUserId,
  });

  if (ownerUserId && getUserNotificationSettings(ownerUserId).email_enabled) {
    enqueueNotification({
      userId: ownerUserId,
      kind: "upload_completed",
      dedupeKey: `upload:${record.token}`,
      payload: JSON.stringify({
        fileName: record.original_name,
        shareUrl: record.content_encryption === "none" ? `${input.origin}/f/${record.token}` : undefined,
        message: record.content_encryption === "none"
          ? "Загрузка файла завершена."
          : "Загрузка E2EE-файла завершена. Ключ находится только в исходной ссылке.",
      }),
    });
  }

  return {
    token: record.token,
    name: record.original_name,
    size: record.size,
    mimeType: record.mime_type,
    expiresAt: record.expires_at,
    maxDownloads: record.max_downloads,
    hasPassword: !!record.password_hash,
    storageEncrypted: record.storage_encryption === "server-v1",
    contentEncryption: record.content_encryption,
    shareUrl: `${input.origin}/f/${record.token}`,
    createdAt: record.created_at,
  };
}
