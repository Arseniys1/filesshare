import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { Readable } from "node:stream";
import type {
  ReadableStream as NodeReadableStream,
  ReadableStreamDefaultReader as NodeReadableStreamDefaultReader,
} from "node:stream/web";

export const STORAGE_ENCRYPTION_VERSION = "server-v1" as const;
export const CONTENT_ENCRYPTION_NONE = "none" as const;
export const CONTENT_ENCRYPTION_E2EE = "e2ee-v1" as const;

export type StorageEncryption = typeof STORAGE_ENCRYPTION_VERSION | "none";
export type ContentEncryption =
  | typeof CONTENT_ENCRYPTION_NONE
  | typeof CONTENT_ENCRYPTION_E2EE;

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_HEADER_BYTES = 4096;
const MAGIC = Buffer.from("FSENC01", "ascii");

interface StorageHeader {
  version: typeof STORAGE_ENCRYPTION_VERSION;
  chunkSize: number;
}

export interface EncryptedFile {
  encryptedSize: number;
  originalSize: number;
  storageEncryption: typeof STORAGE_ENCRYPTION_VERSION;
  storageKeyWrap: string;
}

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function getMasterKey(): Buffer {
  const configured = process.env.FILE_ENCRYPTION_KEY?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FILE_ENCRYPTION_KEY must be set in production");
    }

    // This fallback is only for local development and tests. Production is
    // guarded by the container entrypoint and by this runtime check.
    return createHash("sha256")
      .update(`filesshare-development-key:${process.cwd()}`)
      .digest();
  }

  const key = decode(configured);
  if (key.length !== KEY_BYTES) {
    throw new Error("FILE_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

function chunkAad(index: number): Buffer {
  const aad = Buffer.allocUnsafe(8);
  aad.writeBigUInt64BE(BigInt(index));
  return aad;
}

function wrapFileKey(fileKey: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getMasterKey(), iv);
  cipher.setAAD(Buffer.from(STORAGE_ENCRYPTION_VERSION, "ascii"));
  const encrypted = Buffer.concat([cipher.update(fileKey), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [STORAGE_ENCRYPTION_VERSION, encode(iv), encode(encrypted), encode(tag)].join(".");
}

function unwrapFileKey(value: string): Buffer {
  const [version, encodedIv, encodedKey, encodedTag] = value.split(".");
  if (version !== STORAGE_ENCRYPTION_VERSION || !encodedIv || !encodedKey || !encodedTag) {
    throw new Error("Неизвестный формат ключа шифрования файла");
  }

  const iv = decode(encodedIv);
  const encryptedKey = decode(encodedKey);
  const tag = decode(encodedTag);
  if (iv.length !== IV_BYTES || encryptedKey.length !== KEY_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Поврежденный ключ шифрования файла");
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, getMasterKey(), iv);
    decipher.setAAD(Buffer.from(STORAGE_ENCRYPTION_VERSION, "ascii"));
    decipher.setAuthTag(tag);
    const fileKey = Buffer.concat([decipher.update(encryptedKey), decipher.final()]);
    if (fileKey.length !== KEY_BYTES) throw new Error("Неверная длина ключа файла");
    return fileKey;
  } catch {
    throw new Error("Не удалось расшифровать ключ файла");
  }
}

async function writeToStream(stream: ReturnType<typeof createWriteStream>, chunk: Buffer) {
  if (stream.write(chunk)) return;
  await once(stream, "drain");
}

export async function encryptFileToPath(
  inputPath: string,
  outputPath: string
): Promise<EncryptedFile> {
  const fileKey = randomBytes(KEY_BYTES);
  const header: StorageHeader = {
    version: STORAGE_ENCRYPTION_VERSION,
    chunkSize: CHUNK_SIZE,
  };
  const encodedHeader = Buffer.from(JSON.stringify(header), "utf8");
  const prefix = Buffer.alloc(MAGIC.length + 4);
  MAGIC.copy(prefix);
  prefix.writeUInt32BE(encodedHeader.length, MAGIC.length);

  const input = createReadStream(inputPath, { highWaterMark: CHUNK_SIZE });
  const output = createWriteStream(outputPath, { flags: "wx" });
  let originalSize = 0;
  let encryptedSize = 0;
  let index = 0;

  try {
    await writeToStream(output, prefix);
    await writeToStream(output, encodedHeader);
    encryptedSize += prefix.length + encodedHeader.length;

    for await (const value of input) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (chunk.length === 0) continue;

      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, fileKey, iv);
      cipher.setAAD(chunkAad(index));
      const encrypted = Buffer.concat([cipher.update(chunk), cipher.final()]);
      const tag = cipher.getAuthTag();
      const frameLength = Buffer.alloc(4);
      frameLength.writeUInt32BE(iv.length + encrypted.length + tag.length);

      await writeToStream(output, frameLength);
      await writeToStream(output, iv);
      await writeToStream(output, encrypted);
      await writeToStream(output, tag);

      originalSize += chunk.length;
      encryptedSize += frameLength.length + iv.length + encrypted.length + tag.length;
      index += 1;
    }

    output.end();
    await once(output, "close");
  } catch (error) {
    input.destroy();
    output.destroy();
    throw error;
  } finally {
    input.destroy();
  }

  return {
    encryptedSize,
    originalSize,
    storageEncryption: STORAGE_ENCRYPTION_VERSION,
    storageKeyWrap: wrapFileKey(fileKey),
  };
}

class ByteReader {
  private readonly reader: NodeReadableStreamDefaultReader<Uint8Array>;
  private chunks: Buffer[] = [];
  private buffered = 0;
  private ended = false;

  constructor(body: NodeReadableStream<Uint8Array>) {
    this.reader = body.getReader();
  }

  private async fill(minimum: number): Promise<boolean> {
    while (this.buffered < minimum && !this.ended) {
      const next = await this.reader.read();
      if (next.done) {
        this.ended = true;
        break;
      }
      if (next.value.length === 0) continue;
      const chunk = Buffer.from(next.value);
      this.chunks.push(chunk);
      this.buffered += chunk.length;
    }
    return this.buffered >= minimum;
  }

  async readExactly(length: number): Promise<Buffer> {
    if (length < 0 || !(await this.fill(length))) {
      throw new Error("Поврежденный зашифрованный файл");
    }

    const parts: Buffer[] = [];
    let remaining = length;
    while (remaining > 0) {
      const chunk = this.chunks[0];
      const take = Math.min(remaining, chunk.length);
      parts.push(chunk.subarray(0, take));
      remaining -= take;

      if (take === chunk.length) {
        this.chunks.shift();
      } else {
        this.chunks[0] = chunk.subarray(take);
      }
    }
    this.buffered -= length;
    return parts.length === 1 ? parts[0] : Buffer.concat(parts, length);
  }

  async readOptional(length: number): Promise<Buffer | null> {
    if (this.buffered === 0 && this.ended) return null;
    if (!(await this.fill(length))) {
      if (this.buffered === 0 && this.ended) return null;
      throw new Error("Поврежденный зашифрованный файл");
    }
    return this.readExactly(length);
  }
}

export async function* decryptStorageStream(
  body: NodeReadableStream<Uint8Array>,
  storageKeyWrap: string,
  expectedSize?: number
): AsyncGenerator<Buffer> {
  const reader = new ByteReader(body);
  const magic = await reader.readExactly(MAGIC.length);
  if (!magic.equals(MAGIC)) throw new Error("Неизвестный формат зашифрованного файла");

  const headerLength = (await reader.readExactly(4)).readUInt32BE();
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) {
    throw new Error("Поврежденный заголовок зашифрованного файла");
  }

  let header: StorageHeader;
  try {
    header = JSON.parse((await reader.readExactly(headerLength)).toString("utf8")) as StorageHeader;
  } catch {
    throw new Error("Поврежденный заголовок зашифрованного файла");
  }
  if (
    header.version !== STORAGE_ENCRYPTION_VERSION ||
    !Number.isSafeInteger(header.chunkSize) ||
    header.chunkSize < 1 ||
    header.chunkSize > CHUNK_SIZE
  ) {
    throw new Error("Неподдерживаемая версия зашифрованного файла");
  }

  const fileKey = unwrapFileKey(storageKeyWrap);
  let index = 0;
  let plainSize = 0;

  while (true) {
    const encodedFrameLength = await reader.readOptional(4);
    if (!encodedFrameLength) break;

    const frameLength = encodedFrameLength.readUInt32BE();
    const minFrameLength = IV_BYTES + TAG_BYTES;
    if (
      frameLength < minFrameLength ||
      frameLength > header.chunkSize + TAG_BYTES + IV_BYTES
    ) {
      throw new Error("Поврежденный блок зашифрованного файла");
    }

    const iv = await reader.readExactly(IV_BYTES);
    const encryptedLength = frameLength - IV_BYTES - TAG_BYTES;
    const encrypted = await reader.readExactly(encryptedLength);
    const tag = await reader.readExactly(TAG_BYTES);

    try {
      const decipher = createDecipheriv(ALGORITHM, fileKey, iv);
      decipher.setAAD(chunkAad(index));
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      plainSize += plain.length;
      index += 1;
      yield plain;
    } catch {
      throw new Error("Проверка целостности зашифрованного файла не пройдена");
    }
  }

  if (expectedSize !== undefined && plainSize !== expectedSize) {
    throw new Error("Размер расшифрованного файла не совпадает с метаданными");
  }
}

export function decryptedStreamToWeb(
  body: NodeReadableStream<Uint8Array>,
  storageKeyWrap: string,
  expectedSize?: number
): NodeReadableStream<Uint8Array> {
  return Readable.toWeb(
    Readable.from(decryptStorageStream(body, storageKeyWrap, expectedSize))
  ) as NodeReadableStream<Uint8Array>;
}
