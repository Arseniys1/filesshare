import { NextRequest, NextResponse } from "next/server";
import { getAccessibleSession } from "@/lib/upload-session-service";
import { getUploadSessionParts } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = getAccessibleSession(request, id);
  if (!session) return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  const parts = getUploadSessionParts(id);
  return NextResponse.json({
    sessionId: session.id,
    status: session.status,
    totalSize: session.total_size,
    chunkSize: session.chunk_size,
    totalChunks: session.total_chunks,
    uploadedParts: parts.map((part) => ({ index: part.part_index, size: part.size, checksum: part.checksum })),
    result: session.result_json ? JSON.parse(session.result_json) : null,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = getAccessibleSession(request, id);
  if (!session) return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  const { rm } = await import("node:fs/promises");
  await rm(session.upload_root, { recursive: true, force: true }).catch(() => {});
  const { deleteUploadSession, setUploadSessionStatus } = await import("@/lib/db");
  setUploadSessionStatus(id, "cancelled");
  deleteUploadSession(id);
  return NextResponse.json({ success: true });
}
