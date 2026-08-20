import { NextRequest } from "next/server";
import { deleteUploadSession, getUploadSessionParts, setUploadSessionStatus } from "@/lib/db";
import { apiError, apiOk, requireApiKey } from "@/lib/api-v1";
import { getAccessibleSession } from "@/lib/upload-session-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireApiKey(request);
  if (auth.response) return auth.response;
  const id = (await params).id;
  const session = getAccessibleSession(request, id, auth.context.user.id);
  if (!session) return apiError("session_not_found", "Сессия не найдена", 404);
  return apiOk({
    sessionId: session.id,
    status: session.status,
    totalSize: session.total_size,
    chunkSize: session.chunk_size,
    totalChunks: session.total_chunks,
    uploadedParts: getUploadSessionParts(id).map((part) => ({ index: part.part_index, size: part.size, checksum: part.checksum })),
    result: session.result_json ? JSON.parse(session.result_json) : null,
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireApiKey(request);
  if (auth.response) return auth.response;
  const id = (await params).id;
  const session = getAccessibleSession(request, id, auth.context.user.id);
  if (!session) return apiError("session_not_found", "Сессия не найдена", 404);
  const { rm } = await import("node:fs/promises");
  await rm(session.upload_root, { recursive: true, force: true }).catch(() => {});
  setUploadSessionStatus(id, "cancelled");
  deleteUploadSession(id);
  return apiOk({ success: true });
}
