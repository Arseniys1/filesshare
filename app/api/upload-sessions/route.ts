import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/utils";
import { getCurrentUserStatus } from "@/lib/auth";
import { createUploadSession, getActiveStorageAccounts, getActiveUploadSessionCount, getUserById, getUserQuotaUsage, UploadSessionQuotaError } from "@/lib/db";
import {
  createSessionRoot,
  parseSessionChecksum,
  parseSessionMaxDownloads,
  sessionCookieName,
  sessionExpiresAt,
  UPLOAD_CHUNK_SIZE,
  validateSessionExpiry,
  validateSessionGroup,
  normalizeSessionFileName,
} from "@/lib/upload-session-service";
import { getMaxFileSizeBytes } from "@/lib/telegram-config";
import { getE2EEEncryptedSize, E2EE_CHUNK_SIZE } from "@/lib/e2ee-client";
import { validateUploadFileType } from "@/lib/file-validation";
import { getClientIp } from "@/lib/upload-rate-limit";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let uploadRoot: string | null = null;
  try {
    const body = await readJsonWithLimit<Record<string, unknown>>(request, 64 * 1024);
    if (getActiveStorageAccounts().length === 0) throw new Error("Сервис хранения пока не настроен. Обратитесь к администратору.");
    const sessionStatus = getCurrentUserStatus(request);
    if (sessionStatus.blocked) throw new Error("Пользователь заблокирован");
    const user = sessionStatus.user;
    if (user) {
      const userRecord = getUserById(user.id);
      if (userRecord?.max_file_size && Number(body.originalSize ?? body.totalSize) > userRecord.max_file_size) {
        throw new Error("Файл превышает индивидуальный лимит пользователя");
      }
      const requestedMaxDownloads = parseSessionMaxDownloads(body.maxDownloads);
      if (userRecord?.max_downloads && requestedMaxDownloads !== null && requestedMaxDownloads > userRecord.max_downloads) {
        throw new Error("Лимит скачиваний превышает ограничение пользователя");
      }
      if (userRecord?.max_parallel_uploads && getActiveUploadSessionCount(user.id) >= userRecord.max_parallel_uploads) {
        throw new Error("Превышен лимит параллельных загрузок пользователя");
      }
    }
    const fileName = normalizeSessionFileName(body.fileName);
    const mimeType = typeof body.mimeType === "string" && body.mimeType.length <= 255 ? body.mimeType : "application/octet-stream";
    validateUploadFileType(fileName, mimeType);
    const totalSize = Number(body.totalSize);
    if (!Number.isSafeInteger(totalSize) || totalSize < 1) throw new Error("Некорректный размер файла");
    const contentEncryption = body.contentEncryption === "e2ee-v1" ? "e2ee-v1" : "none";
    const originalSize = contentEncryption === "e2ee-v1" ? Number(body.originalSize) : totalSize;
    if (!Number.isSafeInteger(originalSize) || originalSize < 1 || originalSize > getMaxFileSizeBytes()) throw new Error("Файл превышает допустимый размер");
    if (totalSize > getMaxFileSizeBytes()) throw new Error("Файл превышает допустимый размер");
    const totalChunks = contentEncryption === "e2ee-v1"
      ? Math.ceil(originalSize / E2EE_CHUNK_SIZE)
      : Math.ceil(totalSize / UPLOAD_CHUNK_SIZE);
    if (contentEncryption === "e2ee-v1" && totalSize !== getE2EEEncryptedSize(originalSize)) {
      throw new Error("Некорректный размер E2EE-потока");
    }
    if (typeof body.password === "string" && body.password.length > 1024) throw new Error("Пароль слишком длинный");
    const expiry = validateSessionExpiry(body.expiry || "never");
    const groupToken = typeof body.groupToken === "string" && body.groupToken ? body.groupToken : null;
    validateSessionGroup(request, groupToken);
    if (user && !groupToken) {
      const userRecord = getUserById(user.id);
      if (userRecord?.active_link_limit && getUserQuotaUsage(user.id).activeLinks >= userRecord.active_link_limit) {
        throw new Error("Превышен лимит активных ссылок пользователя");
      }
    }
    const passwordHash = typeof body.password === "string" && body.password ? await hashPassword(body.password) : null;
    const checksum = parseSessionChecksum(body.checksum);
    const maxDownloads = parseSessionMaxDownloads(body.maxDownloads);
    uploadRoot = await createSessionRoot();
    const id = crypto.randomBytes(24).toString("base64url");
    const anonymousToken = user ? null : crypto.randomBytes(32).toString("base64url");
    const session = createUploadSession({
      id,
      owner_user_id: user?.id ?? null,
      anonymous_token: anonymousToken,
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
      max_downloads: maxDownloads,
      password_hash: passwordHash,
      group_token: groupToken,
      upload_root: uploadRoot,
      client_ip: getClientIp(request.headers),
    });
    const response = NextResponse.json({
      success: true,
      sessionId: session.id,
      status: session.status,
      totalSize: session.total_size,
      chunkSize: session.chunk_size,
      totalChunks: session.total_chunks,
      uploadedParts: [],
    });
    if (anonymousToken) {
      response.cookies.set({
        name: sessionCookieName(id),
        value: anonymousToken,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: `/api/upload-sessions/${id}`,
        maxAge: 24 * 60 * 60,
      });
    }
    return response;
  } catch (error) {
    if (error instanceof UploadSessionQuotaError) {
      return NextResponse.json({ error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    }
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    if (uploadRoot) {
      const { rm } = await import("node:fs/promises");
      await rm(uploadRoot, { recursive: true, force: true }).catch(() => {});
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось создать сессию загрузки" }, { status: 400 });
  }
}
