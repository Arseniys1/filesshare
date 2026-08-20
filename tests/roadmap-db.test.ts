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

  it("supports revoke, reusable download reservations and download events", () => {
    const owner = db.getUserByEmail("roadmap-one@example.com")!;
    const file = db.getFileByToken("RoadmapFile01")!;
    const group = db.getFileGroupByToken("RoadmapGroup01")!;
    expect(db.setOwnedTransferRevoked(owner.id, group.token, true)).toBe(true);
    expect(db.reserveGroupDownload(group.token)).toBe(false);
    expect(db.setOwnedTransferRevoked(owner.id, group.token, false)).toBe(true);

    const reusable = db.createFileRecord({ token: "RoadmapReusable", originalName: "reusable.txt", mimeType: "text/plain", size: 1, storageAccountId: file.storage_account_id, telegramFileId: "reusable", telegramMessageId: 3, expiresAt: null, maxDownloads: null, passwordHash: null, ownerUserId: owner.id });
    db.default.prepare("UPDATE files SET pin_hash = ?, one_time = 1, used_at = ?, max_recipients = 1 WHERE token = ?").run("legacy-pin", new Date().toISOString(), reusable.token);
    expect(db.reserveDownload(reusable.token)).toBe(true);
    db.releaseDownloadReservation(reusable.token);
    expect(db.reserveDownload(reusable.token)).toBe(true);

    db.createDownloadEvent({ fileId: reusable.id, groupId: null, outcome: "started", ipHash: "hashed-ip", userAgent: "test-agent", isGroupDownload: false });
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
      upload_root: dataDir,
    });
    db.upsertUploadSessionPart({ session_id: session.id, part_index: 0, size: 4, checksum: "a".repeat(64), path: join(dataDir, "part"), created_at: Date.now() });
    expect(db.getUploadSessionParts(session.id)).toHaveLength(1);
    expect(db.getActiveUploadSessionCount(owner.id)).toBe(1);
    expect(db.updateUserNotificationSettings(owner.id, { email_enabled: 0, expiry_warning_days: 7 })).toMatchObject({ email_enabled: 0, expiry_warning_days: 7 });
  });

  it("paginates admin users and files", () => {
    const usersPageOne = db.getAdminUsersPage(1, 1);
    const usersPageTwo = db.getAdminUsersPage(2, 1);
    expect(usersPageOne.total).toBeGreaterThanOrEqual(2);
    expect(usersPageOne.items).toHaveLength(1);
    expect(usersPageTwo.items).toHaveLength(1);
    expect(usersPageOne.items[0].id).not.toBe(usersPageTwo.items[0].id);

    const filesPageOne = db.getAdminFileOverviewPage(undefined, 1, 1);
    const filesPageTwo = db.getAdminFileOverviewPage(undefined, 2, 1);
    expect(filesPageOne.total).toBeGreaterThanOrEqual(2);
    expect(filesPageOne.items).toHaveLength(1);
    expect(filesPageTwo.items).toHaveLength(1);
    expect(filesPageOne.items[0].token).not.toBe(filesPageTwo.items[0].token);
  });

  it("filters admin records and manages individual files", () => {
    expect(db.getAdminUsersPage(1, 20, "roadmap-one", "active").items.map((user) => user.email)).toContain("roadmap-one@example.com");
    expect(db.getAdminUsersPage(1, 20, "does-not-exist").total).toBe(0);
    expect(db.getAdminFileOverviewPage("two.txt", 1, 20, "active").items.map((file) => file.token)).toContain("RoadmapFile02");

    expect(db.setAdminFileRevoked("RoadmapFile02", true)).toBe(true);
    expect(db.getFileByToken("RoadmapFile02")?.revoked_at).not.toBeNull();
    expect(db.setAdminFileRevoked("RoadmapFile02", false)).toBe(true);
    expect(db.deleteAdminFileRecords("RoadmapFile02")?.[0].original_name).toBe("two.txt");
    expect(db.getFileByToken("RoadmapFile02")).toBeUndefined();
  });
});
