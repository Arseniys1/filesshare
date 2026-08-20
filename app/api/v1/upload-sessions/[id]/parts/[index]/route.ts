import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { NextRequest } from "next/server";
import { getUploadSessionPart, upsertUploadSessionPart } from "@/lib/db";
import { apiError, apiOk, requireApiKey } from "@/lib/api-v1";
import { expectedSessionPartSize, getAccessibleSession } from "@/lib/upload-session-service";

export const runtime = "nodejs";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; index: string }> }) {
  const auth = requireApiKey(request);
  if (auth.response) return auth.response;
  const { id, index: indexText } = await params;
  const session = getAccessibleSession(request, id, auth.context.user.id);
  if (!session || session.status !== "active") return apiError("session_not_found", "Сессия недоступна", 404);
  const index = Number(indexText);
  if (!Number.isSafeInteger(index) || index < 0 || index >= session.total_chunks) return apiError("invalid_part_index", "Некорректный номер части", 400);
  if (!request.body) return apiError("missing_part_body", "Тело части отсутствует", 400);
  const expectedSize = expectedSessionPartSize(session, index);
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isSafeInteger(contentLength) && contentLength !== expectedSize) return apiError("invalid_part_size", "Некорректный размер части", 400);
  const expectedChecksum = request.headers.get("x-chunk-sha256")?.toLowerCase();
  if (!expectedChecksum || !/^[a-f0-9]{64}$/.test(expectedChecksum)) return apiError("missing_part_checksum", "Нужна SHA-256 контрольная сумма части", 400);
  const existing = getUploadSessionPart(id, index);
  if (existing && existing.checksum === expectedChecksum && existing.size === expectedSize) return apiOk({ success: true, index, alreadyUploaded: true });

  const partPath = `${session.upload_root}/part-${index}.bin`;
  await mkdir(session.upload_root, { recursive: true });
  const hash = crypto.createHash("sha256");
  const input = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]);
  let actualSize = 0;
  const hashing = new (class extends Transform {
    _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
      if (actualSize + chunk.length > expectedSize) {
        callback(new Error("Размер части превышает заявленный"));
        return;
      }
      actualSize += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    }
  })();
  try {
    await pipeline(input, hashing, createWriteStream(partPath, { flags: "w" }));
    const actualChecksum = hash.digest("hex");
    const writtenSize = (await stat(partPath)).size;
    if (writtenSize !== expectedSize || actualChecksum !== expectedChecksum) {
      await rm(partPath, { force: true });
      return apiError("part_checksum_mismatch", "Контрольная сумма части не совпадает", 422);
    }
    upsertUploadSessionPart({ session_id: id, part_index: index, size: writtenSize, checksum: actualChecksum, path: partPath, created_at: Date.now() });
    return apiOk({ success: true, index, checksum: actualChecksum });
  } catch (error) {
    await rm(partPath, { force: true }).catch(() => {});
    return apiError("part_upload_failed", error instanceof Error ? error.message : "Ошибка загрузки части", 500);
  }
}
