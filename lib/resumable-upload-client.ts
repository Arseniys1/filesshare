import {
  decodeE2EEKey,
  E2EE_CHUNK_SIZE,
  encryptE2EEChunk,
  encodeE2EEKey,
  getE2EEEncryptedSize,
} from "@/lib/e2ee-client";
import { Sha256 } from "@/lib/sha256";

const SESSION_KEY_PREFIX = "filesshare-upload-session:";

export interface ResumableUploadOptions {
  expiry: string;
  password?: string;
  pin?: string;
  oneTime?: boolean;
  maxDownloads?: string;
  maxRecipients?: string;
  groupToken?: string;
  waitForResume?: () => Promise<void>;
  onProgress?: (uploadedBytes: number, totalBytes: number, uploadedParts?: number, totalParts?: number) => void;
}

interface UploadSessionStatus {
  sessionId: string;
  status: string;
  chunkSize: number;
  totalChunks: number;
  uploadedParts: Array<{ index: number; size?: number; checksum: string }>;
  result?: unknown;
}

function storageKey(file: File, suffix = ""): string {
  return `${SESSION_KEY_PREFIX}${file.name}:${file.size}:${file.lastModified}${suffix}`;
}

function readStoredSession(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStoredSession(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Resuming is best effort. */ }
}

function removeStoredSession(key: string): void {
  try { localStorage.removeItem(key); } catch { /* Ignore storage errors. */ }
}

async function getSession(sessionId: string): Promise<UploadSessionStatus | null> {
  const response = await fetch(`/api/upload-sessions/${encodeURIComponent(sessionId)}`);
  return response.ok ? response.json() : null;
}

async function createSession(
  file: File,
  options: ResumableUploadOptions,
  extra: Record<string, unknown> = {}
): Promise<UploadSessionStatus> {
  const response = await fetch("/api/upload-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      totalSize: file.size,
      expiry: options.expiry,
      ...(options.password ? { password: options.password } : {}),
      ...(options.pin ? { pin: options.pin } : {}),
      ...(options.oneTime ? { oneTime: true } : {}),
      ...(options.maxDownloads ? { maxDownloads: options.maxDownloads } : {}),
      ...(options.maxRecipients ? { maxRecipients: options.maxRecipients } : {}),
      ...(options.groupToken ? { groupToken: options.groupToken } : {}),
      ...extra,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось создать сессию загрузки");
  return data;
}

async function getOrCreateSession(file: File, options: ResumableUploadOptions): Promise<UploadSessionStatus> {
  const key = storageKey(file);
  const existingId = readStoredSession(key);
  if (existingId) {
    const existing = await getSession(existingId);
    if (existing && (existing.status === "active" || existing.status === "completed")) return existing;
    removeStoredSession(key);
  }
  const session = await createSession(file, options);
  writeStoredSession(key, session.sessionId);
  return session;
}

async function uploadPart(sessionId: string, index: number, chunk: Uint8Array, checksum: string): Promise<void> {
  const response = await fetch(`/api/upload-sessions/${encodeURIComponent(sessionId)}/parts/${index}`, {
    method: "PUT",
    headers: { "X-Chunk-SHA256": checksum },
    body: new Blob([chunk.slice().buffer as ArrayBuffer]),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Не удалось загрузить часть ${index + 1}`);
}

export async function uploadFileResumable(file: File, options: ResumableUploadOptions): Promise<unknown> {
  const key = storageKey(file);
  const session = await getOrCreateSession(file, options);
  if (session.status === "completed" && session.result) {
    removeStoredSession(key);
    return session.result;
  }
  if (session.status !== "active") throw new Error("Сессия загрузки недоступна для продолжения");

  const uploaded = new Set(session.uploadedParts.map((part) => part.index));
  let uploadedBytes = session.uploadedParts.reduce((total, part) => total + (part.size ?? Math.min(session.chunkSize, file.size - part.index * session.chunkSize)), 0);
  const checksum = new Sha256();
  options.onProgress?.(uploadedBytes, file.size, uploaded.size, session.totalChunks);

  for (let index = 0; index < session.totalChunks; index += 1) {
    const start = index * session.chunkSize;
    const chunk = new Uint8Array(await file.slice(start, Math.min(file.size, start + session.chunkSize)).arrayBuffer());
    checksum.update(chunk);
    if (!uploaded.has(index)) {
      await options.waitForResume?.();
      await uploadPart(session.sessionId, index, chunk, new Sha256().update(chunk).digest());
      uploadedBytes += chunk.length;
      uploaded.add(index);
      options.onProgress?.(uploadedBytes, file.size, uploaded.size, session.totalChunks);
    }
  }

  const completed = await fetch(`/api/upload-sessions/${encodeURIComponent(session.sessionId)}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checksum: checksum.digest() }),
  });
  const result = await completed.json();
  if (!completed.ok) throw new Error(result.error || "Не удалось завершить загрузку");
  removeStoredSession(key);
  return result.file;
}

interface StoredE2EESession {
  sessionId: string;
  key: string;
}

function readE2EESession(key: string): StoredE2EESession | null {
  const value = readStoredSession(key);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as StoredE2EESession;
    if (typeof parsed.sessionId === "string" && typeof parsed.key === "string") return parsed;
  } catch {
    // A stale localStorage value is discarded below.
  }
  removeStoredSession(key);
  return null;
}

export async function uploadE2EEFileResumable(file: File, options: ResumableUploadOptions): Promise<{ file: { shareUrl: string; [key: string]: unknown }; key: string }> {
  const key = storageKey(file, ":e2ee");
  let stored = readE2EESession(key);
  let session: UploadSessionStatus | null = stored ? await getSession(stored.sessionId) : null;
  if (!session || (session.status !== "active" && session.status !== "completed")) {
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    stored = { sessionId: "", key: encodeE2EEKey(rawKey) };
    session = await createSession(file, options, {
      totalSize: getE2EEEncryptedSize(file.size),
      originalSize: file.size,
      contentEncryption: "e2ee-v1",
    });
    stored.sessionId = session.sessionId;
    writeStoredSession(key, JSON.stringify(stored));
  }

  if (session.status === "completed" && session.result) {
    removeStoredSession(key);
    return { file: session.result as { shareUrl: string; [key: string]: unknown }, key: stored!.key };
  }
  if (session.status !== "active" || !stored) throw new Error("E2EE-сессия загрузки недоступна для продолжения");

  const rawKey = decodeE2EEKey(stored.key);
  const uploaded = new Set(session.uploadedParts.map((part) => part.index));
  let uploadedBytes = session.uploadedParts.reduce((total, part) => {
    const plainSize = Math.min(E2EE_CHUNK_SIZE, Math.max(0, file.size - part.index * E2EE_CHUNK_SIZE));
    return total + plainSize;
  }, 0);
  const checksum = new Sha256();
  options.onProgress?.(uploadedBytes, file.size, uploaded.size, session.totalChunks);

  for (let index = 0; index < session.totalChunks; index += 1) {
    const encryptedChunk = await encryptE2EEChunk(file, rawKey, index);
    checksum.update(encryptedChunk);
    if (!uploaded.has(index)) {
      await options.waitForResume?.();
      await uploadPart(session.sessionId, index, encryptedChunk, new Sha256().update(encryptedChunk).digest());
      uploadedBytes += Math.min(E2EE_CHUNK_SIZE, file.size - index * E2EE_CHUNK_SIZE);
      uploaded.add(index);
      options.onProgress?.(uploadedBytes, file.size, uploaded.size, session.totalChunks);
    }
  }

  const completed = await fetch(`/api/upload-sessions/${encodeURIComponent(session.sessionId)}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checksum: checksum.digest() }),
  });
  const result = await completed.json();
  if (!completed.ok) throw new Error(result.error || "Не удалось завершить E2EE-загрузку");
  removeStoredSession(key);
  return { file: result.file, key: stored.key };
}
