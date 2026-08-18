import { NextRequest, NextResponse } from "next/server";
import { getUploadSessionParts, setUploadSessionResult, setUploadSessionStatus } from "@/lib/db";
import { getAccessibleSession, assembleSession, cleanupSessionFiles, parseSessionChecksum } from "@/lib/upload-session-service";
import { persistUploadedFile } from "@/lib/upload-service";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = getAccessibleSession(request, id);
  if (!session) return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  if (session.status === "completed" && session.result_json) return NextResponse.json({ success: true, file: JSON.parse(session.result_json), alreadyCompleted: true });
  if (session.status !== "active") return NextResponse.json({ error: "Сессия уже обрабатывается или завершена" }, { status: 409 });
  if (getUploadSessionParts(id).length !== session.total_chunks) return NextResponse.json({ error: "Загрузите все части файла" }, { status: 409 });

  setUploadSessionStatus(id, "assembling");
  try {
    const body = await request.json().catch(() => ({})) as { checksum?: unknown };
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
    return NextResponse.json({ success: true, file });
  } catch (error) {
    setUploadSessionStatus(id, "failed");
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось завершить загрузку" }, { status: 500 });
  }
}
