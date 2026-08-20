import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dataDir = await mkdtemp(join(tmpdir(), "filesshare-telemetry-db-test-"));
process.env.FILESHARE_DATA_DIR = dataDir;

const db = await import("@/lib/db");

afterAll(async () => {
  db.default.close();
  await rm(dataDir, { recursive: true, force: true });
});

const telemetryEvent = {
  eventName: "page_view" as const,
  consentVersion: "telemetry-v1",
  visitorId: "telemetry-visitor-1",
  fingerprintResult: JSON.stringify({ visitorId: "telemetry-visitor-1" }),
  browserToolResult: JSON.stringify({ browser: "Chrome" }),
  clientIp: null,
  serverIp: null,
  ipHash: null,
  ipHashDay: null,
  browserFamily: "Chrome",
  osFamily: "Linux",
  deviceType: "desktop",
  language: "ru-ru",
  viewportBucket: "standard" as const,
  path: "/dashboard",
};

describe("telemetry user association", () => {
  it("links authenticated events and leaves guest events anonymous", () => {
    const user = db.createUser("telemetry-owner@example.com", "hash");

    db.createTelemetryEvent({ ...telemetryEvent, userId: user.id });
    db.createTelemetryEvent({
      ...telemetryEvent,
      userId: null,
      visitorId: "telemetry-guest-1",
      path: "/",
    });

    expect(db.getTelemetryEvents(2)).toMatchObject([
      { user_id: null, user_email: null, visitor_id: "telemetry-guest-1" },
      {
        user_id: user.id,
        user_email: "telemetry-owner@example.com",
        visitor_id: "telemetry-visitor-1",
      },
    ]);
  });
});
