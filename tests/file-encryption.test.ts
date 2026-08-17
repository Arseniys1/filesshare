import { afterAll, describe, expect, it } from "vitest";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { ReadableStream as NodeReadableStream } from "node:stream/web";

process.env.FILE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");

const encryption = await import("@/lib/file-encryption");
const dataDir = await mkdtemp(join(tmpdir(), "filesshare-encryption-test-"));

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("storage encryption", () => {
  it("encrypts and decrypts a large streamed payload", async () => {
    const inputPath = join(dataDir, "input.bin");
    const encryptedPath = join(dataDir, "encrypted.bin");
    const original = Buffer.alloc(4 * 1024 * 1024 + 123);
    for (let index = 0; index < original.length; index += 1) {
      original[index] = index % 251;
    }
    await writeFile(inputPath, original);

    const encrypted = await encryption.encryptFileToPath(inputPath, encryptedPath);
    expect(encrypted.storageEncryption).toBe("server-v1");
    expect(encrypted.storageKeyWrap).toContain("server-v1.");
    expect(encrypted.encryptedSize).toBeGreaterThan(original.length);

    const encryptedBody = Readable.toWeb(createReadStream(encryptedPath)) as NodeReadableStream<Uint8Array>;
    const decrypted = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = Readable.fromWeb(
        encryption.decryptedStreamToWeb(encryptedBody, encrypted.storageKeyWrap, original.length)
      );
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.once("end", () => resolve(Buffer.concat(chunks)));
      stream.once("error", reject);
    });

    expect(decrypted.equals(original)).toBe(true);
  });

  it("rejects tampered ciphertext", async () => {
    const inputPath = join(dataDir, "tamper-input.txt");
    const encryptedPath = join(dataDir, "tamper-encrypted.bin");
    await writeFile(inputPath, Buffer.from("secret payload"));
    const encrypted = await encryption.encryptFileToPath(inputPath, encryptedPath);
    const bytes = await readFile(encryptedPath);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(encryptedPath, bytes);

    const encryptedBody = Readable.toWeb(createReadStream(encryptedPath)) as NodeReadableStream<Uint8Array>;
    await expect(
      new Promise<void>((resolve, reject) => {
        const stream = Readable.fromWeb(
          encryption.decryptedStreamToWeb(encryptedBody, encrypted.storageKeyWrap)
        );
        stream.once("end", () => resolve());
        stream.once("error", reject);
        stream.resume();
      })
    ).rejects.toThrow("Проверка целостности");
  });
});
