import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = await mkdtemp(join(tmpdir(), "filesshare-auth-test-"));
process.env.FILESHARE_DATA_DIR = dataDir;

const db = await import("@/lib/db");
const auth = await import("@/lib/auth");
const passwordUtils = await import("@/lib/utils");

afterAll(async () => {
  db.default.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("user authentication", () => {
  it("makes the first registered user an admin and later users regular users", async () => {
    const admin = db.createUser("admin@example.com", await passwordUtils.hashPassword("admin-pass"));
    const user = db.createUser("user@example.com", await passwordUtils.hashPassword("user-pass"));

    expect(admin.role).toBe("admin");
    expect(user.role).toBe("user");
  });

  it("stores only a session token hash and resolves the session user", () => {
    const token = auth.createOpaqueToken();
    db.createSession(auth.hashOpaqueToken(token), 1, Date.now() + 60_000);

    expect(db.getUserBySessionHash(auth.hashOpaqueToken(token))).toMatchObject({
      id: 1,
      role: "admin",
    });
    expect(db.getUserBySessionHash(auth.hashOpaqueToken("wrong-token"))).toBeUndefined();
  });

  it("allows a reset token once and revokes existing sessions", async () => {
    const token = auth.createResetToken(1);
    const changed = auth.resetPasswordWithToken(
      token,
      await passwordUtils.hashPassword("new-admin-pass")
    );

    expect(changed).toBe(true);
    expect(auth.resetPasswordWithToken(token, await passwordUtils.hashPassword("again"))).toBe(
      false
    );
    await expect(
      passwordUtils.verifyPassword("new-admin-pass", db.getUserById(1)!.password_hash)
    ).resolves.toMatchObject({ valid: true });
  });
});
