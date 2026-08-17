import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { Transform } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getUploadSessionPart, upsertUploadSessionPart } from "@/lib/db";
import { getAccessibleSession, expectedSessionPartSize } from "@/lib/upload-session-service";

export const runtime = "nodejs";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; index: string }> }
) {
  const { id, index: indexText } = await params;
  const session = getAccessibleSession(request, id);
  if (!session || session.status !== "active") return NextResponse.json({ error: "Сессия недоступна" }, { status: 404 });
  const index = Number(indexText);
  if (!Number.isSafeInteger(index) || index < 0 || index >= session.total_chunks) return NextResponse.json({ error: "Некорректный номер части" }, { status: 400 });
  if (!request.body) return NextResponse.json({ error: "Тело части отсутствует" }, { status: 400 });
  const expectedSize = expectedSessionPartSize(session, index);
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isSafeInteger(contentLength) && contentLength !== expectedSize) return NextResponse.json({ error: "Некорректный размер части" }, { status: 400 });
  const expectedChecksum = request.headers.get("x-chunk-sha256")?.toLowerCase();
  if (!expectedChecksum || !/^[a-f0-9]{64}$/.test(expectedChecksum)) return NextResponse.json({ error: "Нужна SHA-256 контрольная сумма части" }, { status: 400 });

  const existing = getUploadSessionPart(id, index);
  if (existing && existing.checksum === expectedChecksum && existing.size === expectedSize) return NextResponse.json({ success: true, index, alreadyUploaded: true });

  const partPath = `${session.upload_root}/part-${index}.bin`;
  await mkdir(session.upload_root, { recursive: true });
  const hash = crypto.createHash("sha256");
  const input = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]);
  const hashing = new (class extends Transform {
    _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
      hash.update(chunk);
      callback(null, chunk);
    }
  })();
  try {
    await pipeline(input, hashing, createWriteStream(partPath, { flags: "w" }));
    const actualChecksum = hash.digest("hex");
    const actualSize = (await stat(partPath)).size;
    if (actualSize !== expectedSize || actualChecksum !== expectedChecksum) {
      await rm(partPath, { force: true });
      return NextResponse.json({ error: "Контрольная сумма части не совпадает" }, { status: 422 });
    }
    upsertUploadSessionPart({ session_id: id, part_index: index, size: actualSize, checksum: actualChecksum, path: partPath, created_at: Date.now() });
    return NextResponse.json({ success: true, index, checksum: actualChecksum });
  } catch (error) {
    await rm(partPath, { force: true }).catch(() => {});
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка загрузки части" }, { status: 500 });
  }
}
