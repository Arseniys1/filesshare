import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

const dataDir = await mkdtemp(join(tmpdir(), "filesshare-api-key-test-"));
process.env.FILESHARE_DATA_DIR = dataDir;

const db = await import("@/lib/db");
const auth = await import("@/lib/auth");
const keys = await import("@/lib/api-keys");
const apiKeyRoute = await import("@/app/api/user/api-keys/route");
const meRoute = await import("@/app/api/v1/me/route");

afterAll(async () => {
  db.default.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("API keys", () => {
  it("stores only a hash, authenticates bearer keys and revokes them", async () => {
    const user = db.createUser("api-key-owner@example.com", "hash");
    const created = keys.createUserApiKey(user.id, "CI integration");

    expect(created.secret).toMatch(/^fs_live_[A-Za-z0-9_-]+$/);
    expect(created.key.name).toBe("CI integration");
    expect(db.default.prepare("SELECT * FROM api_keys WHERE id = ?").get(created.key.id)).not.toMatchObject({ key_hash: created.secret });
    expect(keys.listPublicApiKeys(user.id)[0]).not.toHaveProperty("secret");

    const request = new NextRequest("http://localhost/api/v1/me", {
      headers: { Authorization: `Bearer ${created.secret}` },
    });
    expect(keys.resolveApiKey(request).context?.user.id).toBe(user.id);
    const meResponse = meRoute.GET(request);
    expect(meResponse.status).toBe(200);
    await expect(meResponse.json()).resolves.toMatchObject({ email: user.email });
    expect(db.default.prepare("SELECT last_used_at FROM api_keys WHERE id = ?").get(created.key.id)).toMatchObject({ last_used_at: expect.any(String) });

    expect(keys.revokeUserApiKey(user.id, created.key.id)).toBe(true);
    expect(keys.resolveApiKey(request).context).toBeNull();
    expect(keys.resolveApiKey(request).failure).toBe("invalid");
    expect(meRoute.GET(request).status).toBe(401);
  });

  it("manages keys through a session-only route", async () => {
    const user = db.createUser("api-key-ui@example.com", "hash");
    const session = auth.createUserSession(user.id);
    const request = new NextRequest("http://localhost/api/user/api-keys", {
      headers: { Cookie: `fs_session=${session}` },
    });

    const createdResponse = await apiKeyRoute.POST(new NextRequest(request, {
      method: "POST",
      headers: { Cookie: `fs_session=${session}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Dashboard key" }),
    }));
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created.secret).toMatch(/^fs_live_/);

    for (let index = 0; index < 10; index += 1) {
      keys.createUserApiKey(user.id, `Additional key ${index + 1}`);
    }

    const listResponse = apiKeyRoute.GET(new NextRequest("http://localhost/api/user/api-keys?page=2&pageSize=10", {
      headers: { Cookie: `fs_session=${session}` },
    }));
    const listed = await listResponse.json();
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).not.toHaveProperty("secret");
    expect(listed.total).toBe(11);
    expect(listed.totalPages).toBe(2);

    expect(keys.revokeUserApiKey(user.id, created.key.id)).toBe(true);
    const activeOnlyResponse = apiKeyRoute.GET(request);
    const activeOnly = await activeOnlyResponse.json();
    expect(activeOnly.total).toBe(10);
    expect(activeOnly.items).not.toContainEqual(expect.objectContaining({ id: created.key.id }));
  });
});
