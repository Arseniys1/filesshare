import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { getCurrentUserStatus } from "@/lib/auth";
import {
  getFileGroupByToken,
  getUploadSession,
  getUploadSessionParts,
  getUploadSessionPart,
  getStaleUploadSessions,
  deleteUploadSession,
  type UploadSessionRecord,
} from "@/lib/db";
import { computeExpiresAt, EXPIRY_OPTIONS } from "@/lib/utils";
import { E2EE_CHUNK_SIZE, E2EE_FRAME_OVERHEAD, getE2EEHeaderSize } from "@/lib/e2ee-client";
import type { NextRequest } from "next/server";

export const UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024;
export function sessionCookieName(id: string): string {
  return `fs_upload_${id}`;
}

export function getAccessibleSession(request: NextRequest, id: string, apiUserId?: number): UploadSessionRecord | undefined {
  const session = getUploadSession(id);
  if (!session) return undefined;
  const sessionStatus = apiUserId === undefined ? getCurrentUserStatus(request) : null;
  if (sessionStatus?.blocked) return undefined;
  const userId = apiUserId ?? sessionStatus?.user?.id;
  if (session.owner_user_id !== null) return userId === session.owner_user_id ? session : undefined;
  const cookie = request.cookies.get(sessionCookieName(id))?.value;
  return cookie && cookie === session.anonymous_token ? session : undefined;
}

export function normalizeSessionFileName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Имя файла обязательно");
  const name = path.basename(value).replace(/[\u0000-\u001F\u007F]/g, "_").slice(0, 255);
  if (!name) throw new Error("Некорректное имя файла");
  return name;
}

export function parseSessionChecksum(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) throw new Error("Контрольная сумма должна быть SHA-256");
  return value.toLowerCase();
}

export function parseSessionMaxDownloads(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (!/^\d+$/.test(String(value))) throw new Error("Лимит скачиваний должен быть целым числом");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000_000) throw new Error("Лимит должен быть от 1 до 1 000 000");
  return parsed;
}

export function validateSessionGroup(request: NextRequest, groupToken: string | null, apiUserId?: number): void {
  if (!groupToken) return;
  const group = getFileGroupByToken(groupToken);
  if (!group || group.revoked_at) throw new Error("Группа файлов не найдена или отозвана");
  const userId = apiUserId ?? getCurrentUserStatus(request).user?.id;
  if (group.owner_user_id !== null && group.owner_user_id !== userId) throw new Error("Нет доступа к группе файлов");
}

export async function assembleSession(session: UploadSessionRecord, expectedChecksum?: string | null): Promise<{ filePath: string; size: number; checksum: string }> {
  const parts = getUploadSessionParts(session.id);
  if (parts.length !== session.total_chunks) throw new Error("Загружены не все части файла");
  const outputPath = path.join(session.upload_root, "assembled.bin");
  const output = createWriteStream(outputPath, { flags: "wx" });
  const hash = crypto.createHash("sha256");
  let total = 0;
  try {
    for (let index = 0; index < session.total_chunks; index += 1) {
      const part = getUploadSessionPart(session.id, index);
      if (!part) throw new Error(`Отсутствует часть ${index}`);
      const expectedSize = expectedSessionPartSize(session, index);
      if (part.size !== expectedSize) throw new Error(`Некорректный размер части ${index}`);
      const input = createReadStream(part.path);
      for await (const chunk of input) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(bytes);
        total += bytes.length;
        if (!output.write(bytes)) await once(output, "drain");
      }
    }
    await new Promise<void>((resolve, reject) => {
      output.once("error", reject);
      output.end(() => resolve());
    });
  } catch (error) {
    output.destroy();
    await rm(outputPath, { force: true }).catch(() => {});
    throw error;
  }
  const checksum = hash.digest("hex");
  if (total !== session.total_size || (session.checksum && checksum !== session.checksum) || (expectedChecksum && checksum !== expectedChecksum)) {
    await rm(outputPath, { force: true });
    throw new Error("Итоговая контрольная сумма не совпадает");
  }
  return { filePath: outputPath, size: total, checksum };
}

export async function cleanupSessionFiles(session: UploadSessionRecord): Promise<void> {
  await rm(session.upload_root, { recursive: true, force: true }).catch(() => {});
}

export async function createSessionRoot(): Promise<string> {
  const root = process.env.UPLOAD_TEMP_DIR?.trim() || (await import("node:os")).tmpdir();
  await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, "filesshare-session-"));
}

export async function cleanupStaleUploadSessions(maxAgeMs = 2 * 60 * 60 * 1000): Promise<number> {
  const sessions = getStaleUploadSessions(Date.now() - maxAgeMs);
  for (const session of sessions) {
    await rm(session.upload_root, { recursive: true, force: true }).catch(() => {});
    deleteUploadSession(session.id);
  }
  return sessions.length;
}

export function validateSessionExpiry(expiry: unknown): string {
  if (typeof expiry !== "string" || !EXPIRY_OPTIONS.some((option) => option.value === expiry)) throw new Error("Некорректный срок действия ссылки");
  return expiry;
}

export function sessionExpiresAt(expiry: string): string | null {
  return computeExpiresAt(expiry);
}

export function expectedSessionPartSize(session: UploadSessionRecord, index: number): number {
  if (session.content_encryption === "e2ee-v1") {
    const actualPlainSize = Math.min(E2EE_CHUNK_SIZE, Math.max(0, (session.original_size ?? 0) - index * E2EE_CHUNK_SIZE));
    return actualPlainSize + E2EE_FRAME_OVERHEAD + (index === 0 ? getE2EEHeaderSize() : 0);
  }
  return index === session.total_chunks - 1
    ? session.total_size - session.chunk_size * index
    : session.chunk_size;
}
