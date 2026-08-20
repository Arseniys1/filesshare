import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { hashPassword } from "@/lib/utils";
import { getActiveStorageAccounts, getActiveUploadSessionCount, getUserById, getUserQuotaUsage, createUploadSession } from "@/lib/db";
import { apiError, apiOk, parseJsonObject, requireApiKey } from "@/lib/api-v1";
import {
  createSessionRoot,
  parseSessionChecksum,
  parseSessionMaxDownloads,
  sessionExpiresAt,
  validateSessionExpiry,
  validateSessionGroup,
  normalizeSessionFileName,
  UPLOAD_CHUNK_SIZE,
} from "@/lib/upload-session-service";
import { getMaxFileSizeBytes } from "@/lib/telegram-config";
import { getE2EEEncryptedSize, E2EE_CHUNK_SIZE } from "@/lib/e2ee-client";
import { validateUploadFileType } from "@/lib/file-validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let uploadRoot: string | null = null;
  const auth = requireApiKey(request);
  if (auth.response) return auth.response;
  try {
    const body = parseJsonObject(await request.json());
    if (getActiveStorageAccounts().length === 0) return apiError("storage_unavailable", "Сервис хранения пока не настроен. Обратитесь к администратору.", 503);
    const user = getUserById(auth.context.user.id);
    if (!user || user.blocked_at) return apiError("user_blocked", "Пользователь заблокирован", 403);
    const requestedSize = Number(body.originalSize ?? body.totalSize);
    if (user.max_file_size && requestedSize > user.max_file_size) return apiError("file_size_limit_exceeded", "Файл превышает индивидуальный лимит пользователя", 400);
    const requestedMaxDownloads = parseSessionMaxDownloads(body.maxDownloads);
    if (user.max_downloads && requestedMaxDownloads !== null && requestedMaxDownloads > user.max_downloads) return apiError("max_downloads_exceeded", "Лимит скачиваний превышает ограничение пользователя", 400);
    if (user.max_parallel_uploads && getActiveUploadSessionCount(user.id) >= user.max_parallel_uploads) return apiError("parallel_upload_limit_exceeded", "Превышен лимит параллельных загрузок пользователя", 429);

    const fileName = normalizeSessionFileName(body.fileName);
    const mimeType = typeof body.mimeType === "string" && body.mimeType.length <= 255 ? body.mimeType : "application/octet-stream";
    validateUploadFileType(fileName, mimeType);
    const totalSize = Number(body.totalSize);
    if (!Number.isSafeInteger(totalSize) || totalSize < 1) throw new Error("Некорректный размер файла");
    const contentEncryption = body.contentEncryption === "e2ee-v1" ? "e2ee-v1" : "none";
    const originalSize = contentEncryption === "e2ee-v1" ? Number(body.originalSize) : totalSize;
    if (!Number.isSafeInteger(originalSize) || originalSize < 1 || originalSize > getMaxFileSizeBytes()) throw new Error("Файл превышает допустимый размер");
    if (totalSize > getMaxFileSizeBytes()) throw new Error("Файл превышает допустимый размер");
    const totalChunks = contentEncryption === "e2ee-v1" ? Math.ceil(originalSize / E2EE_CHUNK_SIZE) : Math.ceil(totalSize / UPLOAD_CHUNK_SIZE);
    if (contentEncryption === "e2ee-v1" && totalSize !== getE2EEEncryptedSize(originalSize)) throw new Error("Некорректный размер E2EE-потока");
    if (typeof body.password === "string" && body.password.length > 1024) throw new Error("Пароль слишком длинный");
    const expiry = validateSessionExpiry(body.expiry || "never");
    const groupToken = typeof body.groupToken === "string" && body.groupToken ? body.groupToken : null;
    validateSessionGroup(request, groupToken, user.id);
    if (!groupToken && user.active_link_limit && getUserQuotaUsage(user.id).activeLinks >= user.active_link_limit) return apiError("active_link_limit_exceeded", "Превышен лимит активных ссылок пользователя", 429);
    const passwordHash = typeof body.password === "string" && body.password ? await hashPassword(body.password) : null;
    const checksum = parseSessionChecksum(body.checksum);
    uploadRoot = await createSessionRoot();
    const id = crypto.randomBytes(24).toString("base64url");
    const session = createUploadSession({
      id,
      owner_user_id: user.id,
      anonymous_token: null,
      file_name: fileName,
      mime_type: mimeType,
      total_size: totalSize,
      chunk_size: UPLOAD_CHUNK_SIZE,
      total_chunks: totalChunks,
      checksum,
      content_encryption: contentEncryption,
      original_size: originalSize,
      expiry,
      expires_at: sessionExpiresAt(expiry),
      max_downloads: requestedMaxDownloads,
      password_hash: passwordHash,
      group_token: groupToken,
      upload_root: uploadRoot,
    });
    return apiOk({
      sessionId: session.id,
      status: session.status,
      totalSize: session.total_size,
      chunkSize: session.chunk_size,
      totalChunks: session.total_chunks,
      uploadedParts: [],
    }, 201);
  } catch (error) {
    if (uploadRoot) {
      const { rm } = await import("node:fs/promises");
      await rm(uploadRoot, { recursive: true, force: true }).catch(() => {});
    }
    return apiError("invalid_request", error instanceof Error ? error.message : "Не удалось создать сессию загрузки", 400);
  }
}
