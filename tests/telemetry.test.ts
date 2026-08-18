import { afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  classifyUserAgent,
  hashClientIp,
  isSameOrigin,
  normalizeIpAddress,
  parseTelemetryPayload,
} from "@/lib/telemetry";
import { TELEMETRY_CONSENT_VERSION } from "@/lib/telemetry-constants";

const originalSecret = process.env.TELEMETRY_HASH_SECRET;
const browserToolResult = {
  browser: "Chrome",
  gpu: "Google",
  gpuModel: "ANGLE",
  ip: "198.51.100.20",
  userAgent: "Mozilla/5.0",
};

afterAll(() => {
  if (originalSecret === undefined) delete process.env.TELEMETRY_HASH_SECRET;
  else process.env.TELEMETRY_HASH_SECRET = originalSecret;
});

describe("privacy telemetry", () => {
  it("accepts only the consented, constrained payload", () => {
    expect(parseTelemetryPayload({
      eventName: "page_view",
      consentVersion: TELEMETRY_CONSENT_VERSION,
      fingerprintResult: {
        visitorId: "a1b2c3d4e5f6",
        confidence: { score: 0.99, comment: "test" },
        components: { canvas: { value: { geometry: "abc" }, duration: 1 } },
        version: "5.2.0",
      },
      browserToolResult,
      path: "/dashboard?secret=1",
      language: "ru-RU",
      viewportBucket: "standard",
    })).toMatchObject({
      path: "/dashboard",
      language: "ru-ru",
      viewportBucket: "standard",
    });

    expect(parseTelemetryPayload({
      eventName: "page_view",
      consentVersion: "old-version",
      fingerprintResult: {
        visitorId: "a1b2c3d4e5f6",
        confidence: { score: 0.99 },
        components: {},
        version: "5.2.0",
      },
      browserToolResult,
      path: "/",
    })).toBeNull();
  });

  it("preserves the complete FingerprintJS result as JSON", () => {
    const result = parseTelemetryPayload({
      eventName: "page_view",
      consentVersion: TELEMETRY_CONSENT_VERSION,
      fingerprintResult: {
        visitorId: "a1b2c3d4e5f6",
        confidence: { score: 0.87 },
        components: {
          webGlExtensions: { value: { extensions: ["WEBGL_debug_renderer_info"] }, duration: 4 },
        },
        version: "5.2.0",
      },
      browserToolResult,
      path: "/",
    });

    expect(result).not.toBeNull();
    expect(JSON.parse(result!.fingerprintResult)).toEqual(expect.objectContaining({
      visitorId: "a1b2c3d4e5f6",
      confidence: { score: 0.87 },
    }));
    expect(result!.visitorId).toBe("a1b2c3d4e5f6");
  });

  it("classifies user-agent data without retaining the raw header", () => {
    expect(classifyUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36"
    )).toEqual({ browserFamily: "Chrome", osFamily: "Android", deviceType: "mobile" });
  });

  it("preserves the complete browser-tool result and client IP", () => {
    const result = parseTelemetryPayload({
      eventName: "page_view",
      consentVersion: TELEMETRY_CONSENT_VERSION,
      fingerprintResult: {
        visitorId: "a1b2c3d4e5f6",
        confidence: { score: 0.87 },
        components: {},
        version: "5.2.0",
      },
      browserToolResult,
      path: "/",
    });

    expect(result).not.toBeNull();
    expect(JSON.parse(result!.browserToolResult)).toEqual(browserToolResult);
    expect(result!.clientIp).toBe("198.51.100.20");
  });

  it("rotates the IP hash daily and does not hash without a secret", () => {
    delete process.env.TELEMETRY_HASH_SECRET;
    expect(hashClientIp("198.51.100.10").hash).toBeNull();

    process.env.TELEMETRY_HASH_SECRET = "test-secret";
    const first = hashClientIp("198.51.100.10", new Date("2026-08-18T00:00:00Z"));
    const second = hashClientIp("198.51.100.10", new Date("2026-08-19T00:00:00Z"));
    expect(first.hash).toBeTruthy();
    expect(first.hash).not.toBe(second.hash);
    expect(first.day).toBe("2026-08-18");
  });

  it("accepts localhost and loopback aliases as the same development origin", () => {
    expect(isSameOrigin(new NextRequest("http://127.0.0.1:3000/api/telemetry", {
      headers: { origin: "http://localhost:3000" },
    }))).toBe(true);

    expect(isSameOrigin(new NextRequest("http://127.0.0.1:3000/api/telemetry", {
      headers: { origin: "http://attacker.example" },
    }))).toBe(false);
  });

  it("accepts only real IP addresses", () => {
    expect(normalizeIpAddress("198.51.100.20")).toBe("198.51.100.20");
    expect(normalizeIpAddress("2001:db8::20")).toBe("2001:db8::20");
    expect(normalizeIpAddress("unknown")).toBeNull();
  });
});
