import { NextRequest } from "next/server";
import { getUploadSessionParts, setUploadSessionResult, setUploadSessionStatus } from "@/lib/db";
import { apiError, apiOk, requireApiKey } from "@/lib/api-v1";
import { assembleSession, cleanupSessionFiles, getAccessibleSession, parseSessionChecksum } from "@/lib/upload-session-service";
import { persistUploadedFile } from "@/lib/upload-service";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireApiKey(request);
  if (auth.response) return auth.response;
  const id = (await params).id;
  const session = getAccessibleSession(request, id, auth.context.user.id);
  if (!session) return apiError("session_not_found", "Сессия не найдена", 404);
  if (session.status === "completed" && session.result_json) return apiOk({ success: true, file: JSON.parse(session.result_json), alreadyCompleted: true });
  if (session.status !== "active") return apiError("session_unavailable", "Сессия уже обрабатывается или завершена", 409);
  if (getUploadSessionParts(id).length !== session.total_chunks) return apiError("missing_parts", "Загрузите все части файла", 409);
  setUploadSessionStatus(id, "assembling");
  try {
    const rawBody = await request.json().catch(() => ({}));
    const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) ? rawBody as Record<string, unknown> : {};
    const checksum = parseSessionChecksum(body.checksum);
    const assembled = await assembleSession(session, checksum);
    const file = await persistUploadedFile({
      filePath: assembled.filePath,
      tempDir: session.upload_root,
      fileName: session.file_name,
      mimeType: session.mime_type,
      size: session.original_size ?? session.total_size,
      contentSize: assembled.size,
      expiry: session.expiry,
      expiresAt: session.expires_at,
      password: null,
      passwordHash: session.password_hash,
      maxDownloads: session.max_downloads,
      contentEncryption: session.content_encryption,
      groupToken: session.group_token,
      ownerUserId: session.owner_user_id,
      origin: request.nextUrl.origin,
    });
    setUploadSessionResult(id, file);
    await cleanupSessionFiles(session);
    return apiOk({ success: true, file });
  } catch (error) {
    setUploadSessionStatus(id, "failed");
    return apiError("upload_completion_failed", error instanceof Error ? error.message : "Не удалось завершить загрузку", 500);
  }
}
