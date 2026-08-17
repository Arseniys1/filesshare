export const CONTENT_ENCRYPTION_VERSION = "e2ee-v1" as const;
export const E2EE_CHUNK_SIZE = 4 * 1024 * 1024;
export const E2EE_BUFFERED_FALLBACK_LIMIT = 512 * 1024 * 1024;

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_HEADER_BYTES = 4096;
const MAGIC = new TextEncoder().encode("FSE2EE1");

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.length);
  copy.set(value);
  return copy.buffer;
}

function concatBytes(...values: Uint8Array[]): Uint8Array {
  const length = values.reduce((total, value) => total + value.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function uint32(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value);
  return result;
}

function chunkAad(index: number): Uint8Array {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, BigInt(index));
  return result;
}

function readUint32(value: Uint8Array): number {
  return new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(0);
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  const blockSize = 0x8000;
  for (let offset = 0; offset < value.length; offset += blockSize) {
    binary += String.fromCharCode(...value.subarray(offset, offset + blockSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function encodeE2EEKey(rawKey: Uint8Array): string {
  if (rawKey.length !== KEY_BYTES) throw new Error("Некорректная длина ключа шифрования");
  return encodeBase64Url(rawKey);
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Некорректный ключ шифрования");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  return result;
}

export function decodeE2EEKey(value: string): Uint8Array {
  const rawKey = decodeBase64Url(value);
  if (rawKey.length !== KEY_BYTES) throw new Error("Некорректная длина ключа шифрования");
  return rawKey;
}

function makeHeader(): Uint8Array {
  const header = new TextEncoder().encode(
    JSON.stringify({ version: CONTENT_ENCRYPTION_VERSION, chunkSize: E2EE_CHUNK_SIZE })
  );
  if (header.length > MAX_HEADER_BYTES) throw new Error("Слишком большой заголовок шифрования");
  return concatBytes(MAGIC, uint32(header.length), header);
}

export function getE2EEHeaderSize(): number {
  return makeHeader().length;
}

export function getE2EEEncryptedSize(originalSize: number): number {
  if (!Number.isSafeInteger(originalSize) || originalSize < 1) {
    throw new Error("Некорректный размер E2EE-файла");
  }
  return getE2EEHeaderSize() + originalSize + Math.ceil(originalSize / E2EE_CHUNK_SIZE) * (IV_BYTES + TAG_BYTES);
}

function takePending(
  parts: Uint8Array[],
  totalLength: number,
  length: number
): { chunk: Uint8Array; rest: Uint8Array[]; restLength: number } {
  const combined = concatBytes(...parts);
  return {
    chunk: combined.slice(0, length),
    rest: combined.length > length ? [combined.slice(length)] : [],
    restLength: Math.max(0, totalLength - length),
  };
}

async function importEncryptionKey(rawKey: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  if (rawKey.length !== KEY_BYTES) throw new Error("Некорректная длина ключа шифрования");
  return crypto.subtle.importKey("raw", toArrayBuffer(rawKey), { name: "AES-GCM" }, false, [usage]);
}

export interface E2EEUpload {
  body: ReadableStream<Uint8Array>;
  key: string;
}

export function createE2EEUpload(file: File): E2EEUpload {
  if (!crypto?.subtle) throw new Error("Браузер не поддерживает сквозное шифрование");

  const rawKey = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const keyPromise = importEncryptionKey(rawKey, "encrypt");
  const source = file.stream().getReader();
  let key: CryptoKey | null = null;
  let headerSent = false;
  let sourceDone = false;
  let suffixSent = false;
  let index = 0;
  let pendingParts: Uint8Array[] = [];
  let pendingLength = 0;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!headerSent) {
          controller.enqueue(makeHeader());
          headerSent = true;
          return;
        }

        if (!key) key = await keyPromise;

        while (!sourceDone && pendingLength < E2EE_CHUNK_SIZE) {
          const next = await source.read();
          if (next.done) {
            sourceDone = true;
            break;
          }
          if (next.value.length > 0) {
            pendingParts.push(next.value);
            pendingLength += next.value.length;
          }
        }

        if (pendingLength === 0 && sourceDone) {
          if (!suffixSent) {
            suffixSent = true;
            controller.close();
          }
          return;
        }

        const plainLength = Math.min(pendingLength, E2EE_CHUNK_SIZE);
        const taken = takePending(pendingParts, pendingLength, plainLength);
        pendingParts = taken.rest;
        pendingLength = taken.restLength;

        const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
        const encrypted = new Uint8Array(
          await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(chunkAad(index)) },
            key,
            toArrayBuffer(taken.chunk)
          )
        );
        const frameLength = iv.length + encrypted.length;
        controller.enqueue(concatBytes(uint32(frameLength), iv, encrypted));
        index += 1;
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await source.cancel(reason);
    },
  });

  return { body, key: encodeE2EEKey(rawKey) };
}

function uint64(value: number): Uint8Array {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, BigInt(value));
  return result;
}

async function deterministicIv(rawKey: Uint8Array, index: number): Promise<Uint8Array> {
  const material = new Uint8Array(rawKey.length + 8);
  material.set(rawKey);
  material.set(uint64(index), rawKey.length);
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(material));
  return new Uint8Array(digest).slice(0, IV_BYTES);
}

/**
 * Encrypts one deterministic E2EE part. Deterministic IVs are used only for
 * resumable uploads so the browser can recreate a missing part after reload.
 * The random-key requirement still guarantees IV uniqueness for a file.
 */
export async function encryptE2EEChunk(
  file: File,
  rawKey: Uint8Array,
  index: number
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("Некорректный номер E2EE-части");
  const plain = new Uint8Array(await file.slice(index * E2EE_CHUNK_SIZE, (index + 1) * E2EE_CHUNK_SIZE).arrayBuffer());
  if (plain.length === 0) throw new Error("Пустая E2EE-часть");
  const key = await importEncryptionKey(rawKey, "encrypt");
  const iv = await deterministicIv(rawKey, index);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(chunkAad(index)) },
    key,
    toArrayBuffer(plain)
  ));
  const frame = concatBytes(uint32(iv.length + encrypted.length), iv, encrypted);
  return index === 0 ? concatBytes(makeHeader(), frame) : frame;
}

function escapeMultipartFilename(name: string): string {
  return name.replace(/[\\"\r\n]/g, "_").slice(0, 255) || "file";
}

function multipartField(boundary: string, name: string, value: string): Uint8Array {
  return new TextEncoder().encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  );
}

export function createE2EEMultipartUpload(
  file: File,
  fields: Record<string, string>
): E2EEUpload & { boundary: string } {
  const encrypted = createE2EEUpload(file);
  const boundary = `----FileShareE2EE${crypto.randomUUID().replace(/-/g, "")}`;
  const prefix = [
    ...Object.entries(fields).map(([name, value]) => multipartField(boundary, name, value)),
    new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${escapeMultipartFilename(file.name)}"\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`
    ),
  ];
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const encryptedReader = encrypted.body.getReader();
  let prefixIndex = 0;
  let suffixSent = false;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (prefixIndex < prefix.length) {
        controller.enqueue(prefix[prefixIndex]);
        prefixIndex += 1;
        return;
      }

      const next = await encryptedReader.read();
      if (!next.done) {
        controller.enqueue(next.value);
        return;
      }

      if (!suffixSent) {
        suffixSent = true;
        controller.enqueue(suffix);
        controller.close();
      }
    },
    async cancel(reason) {
      await encryptedReader.cancel(reason);
    },
  });

  return { body, key: encrypted.key, boundary };
}

export async function createBufferedE2EEMultipartUpload(
  file: File,
  fields: Record<string, string>
): Promise<{ body: Blob; key: string; boundary: string }> {
  if (file.size > E2EE_BUFFERED_FALLBACK_LIMIT) {
    throw new Error(
      "Потоковая E2EE-загрузка недоступна в этом соединении. Для файлов больше 512 МБ используйте HTTPS или Chrome/Edge."
    );
  }

  const encrypted = createE2EEMultipartUpload(file, fields);
  const reader = encrypted.body.getReader();
  const chunks: ArrayBuffer[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(toArrayBuffer(next.value));
  }

  return {
    body: new Blob(chunks, { type: `multipart/form-data; boundary=${encrypted.boundary}` }),
    key: encrypted.key,
    boundary: encrypted.boundary,
  };
}

export function addE2EEKeyToShareUrl(shareUrl: string, key: string): string {
  return `${shareUrl.split("#", 1)[0]}#key=${encodeURIComponent(key)}`;
}

export function readE2EEKeyFromHash(hash: string): Uint8Array | null {
  if (!hash.startsWith("#")) return null;
  const key = new URLSearchParams(hash.slice(1)).get("key");
  if (!key) return null;
  return decodeE2EEKey(key);
}

export function addE2EEKeysToShareUrl(
  shareUrl: string,
  keys: Record<string, string>
): string {
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(keys)));
  return `${shareUrl.split("#", 1)[0]}#keys=${encodeURIComponent(payload)}`;
}

export function readE2EEKeysFromHash(hash: string): Record<string, Uint8Array> {
  if (!hash.startsWith("#")) return {};
  const encoded = new URLSearchParams(hash.slice(1)).get("keys");
  if (!encoded) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded)));
  } catch {
    throw new Error("Некорректные ключи сквозного шифрования");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Некорректные ключи сквозного шифрования");
  }

  const result: Record<string, Uint8Array> = {};
  for (const [token, value] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(token) || typeof value !== "string") {
      throw new Error("Некорректные ключи сквозного шифрования");
    }
    const raw = decodeBase64Url(value);
    if (raw.length !== KEY_BYTES) throw new Error("Некорректная длина ключа шифрования");
    result[token] = raw;
  }
  return result;
}

class ByteReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  private ended = false;

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
  }

  private async fill(length: number): Promise<boolean> {
    while (this.buffered < length && !this.ended) {
      const next = await this.reader.read();
      if (next.done) {
        this.ended = true;
        break;
      }
      if (next.value.length === 0) continue;
      this.chunks.push(next.value);
      this.buffered += next.value.length;
    }
    return this.buffered >= length;
  }

  async readExactly(length: number): Promise<Uint8Array> {
    if (!(await this.fill(length))) throw new Error("Поврежденный E2EE-файл");
    const parts: Uint8Array[] = [];
    let remaining = length;
    while (remaining > 0) {
      const chunk = this.chunks[0];
      const take = Math.min(remaining, chunk.length);
      parts.push(chunk.slice(0, take));
      remaining -= take;
      if (take === chunk.length) this.chunks.shift();
      else this.chunks[0] = chunk.slice(take);
    }
    this.buffered -= length;
    return parts.length === 1 ? parts[0] : concatBytes(...parts);
  }

  async readOptional(length: number): Promise<Uint8Array | null> {
    if (this.buffered === 0 && this.ended) return null;
    if (!(await this.fill(length))) {
      if (this.buffered === 0 && this.ended) return null;
      throw new Error("Поврежденный E2EE-файл");
    }
    return this.readExactly(length);
  }
}

export interface DownloadSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(reason: unknown): Promise<void>;
}

export async function decryptE2EEToSink(
  body: ReadableStream<Uint8Array>,
  rawKey: Uint8Array,
  sink: DownloadSink,
  expectedSize?: number
): Promise<void> {
  const reader = new ByteReader(body);
  const magic = await reader.readExactly(MAGIC.length);
  if (new TextDecoder().decode(magic) !== "FSE2EE1") throw new Error("Неизвестный формат E2EE-файла");

  const headerLength = readUint32(await reader.readExactly(4));
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) {
    throw new Error("Поврежденный заголовок E2EE-файла");
  }
  let header: { version?: string; chunkSize?: number };
  try {
    header = JSON.parse(new TextDecoder().decode(await reader.readExactly(headerLength))) as {
      version?: string;
      chunkSize?: number;
    };
  } catch {
    throw new Error("Поврежденный заголовок E2EE-файла");
  }
  if (
    header.version !== CONTENT_ENCRYPTION_VERSION ||
    header.chunkSize !== E2EE_CHUNK_SIZE
  ) {
    throw new Error("Неподдерживаемая версия E2EE-файла");
  }

  const key = await importEncryptionKey(rawKey, "decrypt");
  let index = 0;
  let plainSize = 0;
  while (true) {
    const frameLengthBytes = await reader.readOptional(4);
    if (!frameLengthBytes) break;
    const frameLength = readUint32(frameLengthBytes);
    if (frameLength < IV_BYTES + TAG_BYTES || frameLength > E2EE_CHUNK_SIZE + IV_BYTES + TAG_BYTES) {
      throw new Error("Поврежденный блок E2EE-файла");
    }

    const iv = await reader.readExactly(IV_BYTES);
    const encrypted = await reader.readExactly(frameLength - IV_BYTES);
    try {
      const plain = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(chunkAad(index)) },
          key,
          toArrayBuffer(encrypted)
        )
      );
      await sink.write(plain);
      plainSize += plain.length;
      index += 1;
    } catch {
      throw new Error("Проверка целостности E2EE-файла не пройдена");
    }
  }

  if (expectedSize !== undefined && plainSize !== expectedSize) {
    throw new Error("Размер расшифрованного E2EE-файла не совпадает с метаданными");
  }
  await sink.close();
}

export async function decryptE2EEToBlob(
  body: ReadableStream<Uint8Array>,
  rawKey: Uint8Array,
  expectedSize: number,
  mimeType: string
): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  await decryptE2EEToSink(
    body,
    rawKey,
    {
      write: async (chunk) => {
        chunks.push(chunk.slice());
      },
      close: async () => {},
    },
    expectedSize
  );
  return new Blob(chunks.map(toArrayBuffer), { type: mimeType || "application/octet-stream" });
}

interface FileSystemWindow extends Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<{
    createWritable: () => Promise<DownloadSink>;
  }>;
}

export async function downloadE2EEFile(options: {
  response: Response;
  rawKey: Uint8Array;
  fileName: string;
  mimeType: string;
  size: number;
}): Promise<void> {
  if (!options.response.body) throw new Error("Сервер не вернул содержимое файла");
  const fileWindow = window as FileSystemWindow;
  const picker = fileWindow.showSaveFilePicker;
  let sink: DownloadSink;
  let fallbackChunks: Uint8Array[] = [];

  const createFallbackSink = (): DownloadSink => {
    if (options.size > E2EE_BUFFERED_FALLBACK_LIMIT) {
      throw new Error("Для больших E2EE-файлов нужен Chrome или Edge с потоковым сохранением");
    }
    return {
      write: async (chunk) => {
        fallbackChunks.push(chunk.slice());
      },
      close: async () => {
        const blob = new Blob(fallbackChunks.map(toArrayBuffer), { type: options.mimeType || "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = options.fileName;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        fallbackChunks = [];
      },
    };
  };

  // Small files are buffered after decryption and downloaded through an
  // anchor. This avoids requiring a user-activation-sensitive picker after
  // the asynchronous HTTP request has completed.
  if (options.size <= E2EE_BUFFERED_FALLBACK_LIMIT) {
    sink = createFallbackSink();
  } else if (picker) {
    try {
      const handle = await picker({
        suggestedName: options.fileName,
        types: [{ description: "Файл", accept: { [options.mimeType || "application/octet-stream"]: ["." + (options.fileName.split(".").pop() || "bin")] } }],
      });
      sink = await handle.createWritable();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      sink = createFallbackSink();
    }
  } else {
    throw new Error("Для больших E2EE-файлов нужен Chrome или Edge с потоковым сохранением");
  }

  try {
    await decryptE2EEToSink(options.response.body, options.rawKey, sink, options.size);
  } catch (error) {
    try {
      await sink.abort?.(error);
    } catch {
      // The download error is more useful than a cleanup error.
    }
    fallbackChunks = [];
    throw error;
  }
}
