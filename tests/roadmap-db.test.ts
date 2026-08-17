import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = await mkdtemp(join(tmpdir(), "filesshare-roadmap-test-"));
process.env.FILESHARE_DATA_DIR = dataDir;

const db = await import("@/lib/db");

afterAll(async () => {
  db.default.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("file management roadmap database", () => {
  it("isolates owned files and groups between users", () => {
    const first = db.createUser("roadmap-one@example.com", "hash");
    const second = db.createUser("roadmap-two@example.com", "hash");
    const account = db.createStorageAccount("roadmap", "roadmap-token", "-100900");
    const group = db.createFileGroup({ token: "RoadmapGroup01", ownerUserId: first.id, expiresAt: null, maxDownloads: 2, passwordHash: null });
    db.createFileRecord({ token: "RoadmapFile01", originalName: "one.txt", mimeType: "text/plain", size: 10, storageAccountId: account.id, telegramFileId: "one", telegramMessageId: 1, expiresAt: null, maxDownloads: 2, passwordHash: null, groupId: group.id, ownerUserId: first.id });
    db.createFileRecord({ token: "RoadmapFile02", originalName: "two.txt", mimeType: "text/plain", size: 20, storageAccountId: account.id, telegramFileId: "two", telegramMessageId: 2, expiresAt: null, maxDownloads: null, passwordHash: null, ownerUserId: second.id });

    expect(db.getOwnedTransfers(first.id).items.map((item) => item.token)).toEqual([group.token]);
    expect(db.getOwnedTransfers(second.id).items.map((item) => item.token)).toEqual(["RoadmapFile02"]);
    expect(db.getOwnedTransferDetails(second.id, group.token)).toBeUndefined();
  });

  it("supports revoke, one-time reservation and download events", () => {
    const owner = db.getUserByEmail("roadmap-one@example.com")!;
    const file = db.getFileByToken("RoadmapFile01")!;
    const group = db.getFileGroupByToken("RoadmapGroup01")!;
    expect(db.setOwnedTransferRevoked(owner.id, group.token, true)).toBe(true);
    expect(db.reserveGroupDownload(group.token)).toBe(false);
    expect(db.setOwnedTransferRevoked(owner.id, group.token, false)).toBe(true);

    const oneTime = db.createFileRecord({ token: "RoadmapOneTime", originalName: "once.txt", mimeType: "text/plain", size: 1, storageAccountId: file.storage_account_id, telegramFileId: "once", telegramMessageId: 3, expiresAt: null, maxDownloads: null, passwordHash: null, ownerUserId: owner.id, oneTime: true, maxRecipients: 1 });
    expect(db.reserveDownload(oneTime.token, "recipient-a")).toBe(true);
    expect(db.reserveDownload(oneTime.token)).toBe(false);
    db.releaseDownloadReservation(oneTime.token);
    expect(db.reserveDownload(oneTime.token, "recipient-a")).toBe(true);

    db.createDownloadEvent({ fileId: oneTime.id, groupId: null, outcome: "started", ipHash: "hashed-ip", userAgent: "test-agent", isGroupDownload: false });
    expect(db.getUserDownloadStats(owner.id).total).toBe(1);
  });

  it("stores resumable parts and applies user notification settings", () => {
    const owner = db.getUserByEmail("roadmap-one@example.com")!;
    const session = db.createUploadSession({
      id: "roadmap-session-01",
      owner_user_id: owner.id,
      anonymous_token: null,
      file_name: "large.bin",
      mime_type: "application/octet-stream",
      total_size: 4,
      chunk_size: 4,
      total_chunks: 1,
      checksum: null,
      content_encryption: "none",
      original_size: 4,
      expiry: "never",
      expires_at: null,
      max_downloads: null,
      password_hash: null,
      group_token: null,
      pin_hash: null,
      one_time: 0,
      max_recipients: null,
      upload_root: dataDir,
    });
    db.upsertUploadSessionPart({ session_id: session.id, part_index: 0, size: 4, checksum: "a".repeat(64), path: join(dataDir, "part"), created_at: Date.now() });
    expect(db.getUploadSessionParts(session.id)).toHaveLength(1);
    expect(db.getActiveUploadSessionCount(owner.id)).toBe(1);
    expect(db.updateUserNotificationSettings(owner.id, { email_enabled: 0, expiry_warning_days: 7 })).toMatchObject({ email_enabled: 0, expiry_warning_days: 7 });
  });
});
