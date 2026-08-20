import { NextRequest } from "next/server";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getActiveStorageAccounts, getUserById } from "@/lib/db";
import { apiError, apiOk, requireApiKey } from "@/lib/api-v1";
import { parseMultipartUpload, UploadValidationError } from "@/app/api/upload/route";
import { persistUploadedFile } from "@/lib/upload-service";
import { getMaxFileSizeBytes, getMaxFileSizeLabel } from "@/lib/telegram-config";
import { abandonUploadLease, acquireUploadLease, finishUploadLease, getClientIp, UploadRateLimitError } from "@/lib/upload-rate-limit";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(request: NextRequest) {
  let tempDir: string | null = null;
  let lease: ReturnType<typeof acquireUploadLease> | null = null;
  let leaseFinished = false;
  const auth = requireApiKey(request);
  if (auth.response) return auth.response;

  try {
    if (getActiveStorageAccounts().length === 0) {
      return apiError("storage_unavailable", "Сервис хранения пока не настроен. Обратитесь к администратору.", 503);
    }
    const user = getUserById(auth.context.user.id);
    const statedLength = Number(request.headers.get("content-length"));
    const expectedBytes = Number.isSafeInteger(statedLength) && statedLength > 0 ? statedLength : getMaxFileSizeBytes();
    lease = acquireUploadLease(getClientIp(request.headers), expectedBytes, user?.id ?? null, user?.max_parallel_uploads ?? null);
    const uploadRoot = process.env.UPLOAD_TEMP_DIR?.trim() || tmpdir();
    await mkdir(uploadRoot, { recursive: true });
    tempDir = await mkdtemp(join(uploadRoot, "filesshare-api-"));
    const upload = await parseMultipartUpload(request, tempDir, getMaxFileSizeBytes());
    const file = await persistUploadedFile({
      filePath: upload.filePath,
      tempDir,
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      size: upload.size,
      contentSize: upload.contentSize,
      expiry: upload.expiry,
      password: upload.password,
      maxDownloads: upload.maxDownloads,
      contentEncryption: upload.contentEncryption,
      groupToken: upload.groupToken,
      ownerUserId: auth.context.user.id,
      origin: request.nextUrl.origin,
    });
    finishUploadLease(lease, upload.contentSize);
    leaseFinished = true;
    return apiOk({ file });
  } catch (error) {
    if (error instanceof UploadRateLimitError) {
      return apiError("rate_limit_exceeded", error.message, 429, { "Retry-After": String(error.retryAfterSeconds) });
    }
    if (error instanceof UploadValidationError) {
      return apiError("invalid_upload", error.message, error.status);
    }
    console.error("API upload error:", error);
    return apiError(
      "upload_failed",
      error instanceof Error ? error.message : `Ошибка загрузки. Максимальный размер — ${getMaxFileSizeLabel()}`,
      500
    );
  } finally {
    if (lease && !leaseFinished) abandonUploadLease(lease);
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
