import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = await mkdtemp(join(tmpdir(), "filesshare-test-"));
process.env.FILESHARE_DATA_DIR = dataDir;

const dbModule = await import("@/lib/db");
const rateLimit = await import("@/lib/upload-rate-limit");
const passwordUtils = await import("@/lib/utils");

afterAll(async () => {
  dbModule.default.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("database invariants", () => {
  it("does not oversubscribe a download limit", () => {
    const account = dbModule.createStorageAccount("test", "test-token", "-1001");
    const file = dbModule.createFileRecord({
      token: "DownloadTest1",
      originalName: "test.txt",
      mimeType: "text/plain",
      size: 1,
      storageAccountId: account.id,
      telegramFileId: "file-id",
      telegramMessageId: 1,
      expiresAt: null,
      maxDownloads: 1,
      passwordHash: null,
    });

    expect(dbModule.reserveDownload(file.token)).toBe(true);
    expect(dbModule.reserveDownload(file.token)).toBe(false);
  });

  it("upgrades an existing legacy password without invalidating its link", async () => {
    const account =
      dbModule.getStorageAccountById(1) ||
      dbModule.createStorageAccount("legacy-test", "legacy-test-token", "-1002");
    const legacy = "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b";
    const file = dbModule.createFileRecord({
      token: "LegacyPassword1",
      originalName: "legacy.txt",
      mimeType: "text/plain",
      size: 1,
      storageAccountId: account.id,
      telegramFileId: "legacy-file-id",
      telegramMessageId: 2,
      expiresAt: null,
      maxDownloads: null,
      passwordHash: legacy,
    });

    const verification = await passwordUtils.verifyPassword("secret", legacy);
    expect(verification).toEqual({ valid: true, needsRehash: true });
    dbModule.updateFilePasswordHash(file.token, await passwordUtils.hashPassword("secret"));
    const upgraded = dbModule.getFileByToken(file.token)!;
    expect(upgraded.password_hash).toMatch(/^scrypt\$/);
    await expect(passwordUtils.verifyPassword("secret", upgraded.password_hash!)).resolves.toMatchObject({
      valid: true,
      needsRehash: false,
    });
  });

  it("enforces concurrent upload leases", () => {
    const ip = "198.51.100.10";
    const first = rateLimit.acquireUploadLease(ip);
    const second = rateLimit.acquireUploadLease(ip);
    const third = rateLimit.acquireUploadLease(ip);
    expect(() => rateLimit.acquireUploadLease(ip)).toThrow(rateLimit.UploadRateLimitError);

    rateLimit.abandonUploadLease(first);
    rateLimit.abandonUploadLease(second);
    rateLimit.abandonUploadLease(third);
  });
});
