import crypto from "node:crypto";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import { TELEMETRY_CONSENT_VERSION } from "@/lib/telemetry-constants";

export { TELEMETRY_CONSENT_VERSION } from "@/lib/telemetry-constants";
export const DEFAULT_TELEMETRY_RETENTION_DAYS = 30;
const MAX_FINGERPRINT_RESULT_BYTES = 64 * 1024;
const MAX_BROWSER_TOOL_RESULT_BYTES = 64 * 1024;

export type TelemetryViewportBucket = "compact" | "standard" | "wide";

export interface TelemetryPayload {
  eventName: "page_view";
  consentVersion: string;
  visitorId: string;
  fingerprintResult: string;
  browserToolResult: string;
  clientIp: string | null;
  path: string;
  language: string | null;
  viewportBucket: TelemetryViewportBucket | null;
}

export function normalizeIpAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ip = value.trim();
  return ip.length <= 128 && isIP(ip) ? ip : null;
}

function firstForwardedIp(value: string | null): string | null {
  return normalizeIpAddress(value?.split(",")[0]);
}

export function getClientIp(request: NextRequest): string | null {
  const directIp = normalizeIpAddress((request as NextRequest & { ip?: string }).ip);
  if (process.env.TRUST_PROXY === "1") {
    return firstForwardedIp(request.headers.get("x-forwarded-for"))
      || firstForwardedIp(request.headers.get("x-real-ip"))
      || directIp;
  }
  return directIp || firstForwardedIp(request.headers.get("x-real-ip"));
}

export function hashClientIp(ip: string | null, now = new Date()): {
  hash: string | null;
  day: string | null;
} {
  const secret = process.env.TELEMETRY_HASH_SECRET?.trim();
  if (!secret || !ip) return { hash: null, day: null };

  const day = now.toISOString().slice(0, 10);
  const hash = crypto
    .createHmac("sha256", secret)
    .update(`${day}:${ip}`)
    .digest("hex");
  return { hash, day };
}

export function classifyUserAgent(userAgent: string | null): {
  browserFamily: string;
  osFamily: string;
  deviceType: string;
} {
  const value = userAgent || "";
  const browserFamily = /SamsungBrowser\//i.test(value)
    ? "Samsung Internet"
    : /Edg\//i.test(value)
      ? "Edge"
      : /OPR\//i.test(value)
        ? "Opera"
        : /Firefox\//i.test(value)
          ? "Firefox"
          : /CriOS\//i.test(value)
            ? "Chrome iOS"
            : /Chrome\//i.test(value)
              ? "Chrome"
              : /Safari\//i.test(value)
                ? "Safari"
                : "Other";

  const osFamily = /Windows/i.test(value)
    ? "Windows"
    : /Android/i.test(value)
      ? "Android"
      : /iPhone|iPad|iPod/i.test(value)
        ? "iOS"
        : /Mac OS X/i.test(value)
          ? "macOS"
          : /Linux/i.test(value)
            ? "Linux"
            : "Other";

  const deviceType = /iPad|Tablet/i.test(value) || (/Android/i.test(value) && !/Mobile/i.test(value))
    ? "tablet"
    : /Mobile|iPhone|iPod|Android/i.test(value)
      ? "mobile"
      : "desktop";

  return { browserFamily, osFamily, deviceType };
}

function normalizeLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const language = value.trim().slice(0, 16);
  return /^[a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?$/.test(language) ? language.toLowerCase() : null;
}

function normalizeViewportBucket(value: unknown): TelemetryViewportBucket | null {
  return value === "compact" || value === "standard" || value === "wide" ? value : null;
}

function normalizePath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  const path = value.split(/[?#]/, 1)[0]?.slice(0, 200) || "/";
  return path.includes("\\") ? null : path;
}

function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (typeof value !== "object") return false;

  return Object.values(value as Record<string, unknown>).every((item) =>
    isJsonValue(item, depth + 1)
  );
}

function normalizeFingerprintResult(value: unknown): { visitorId: string; serialized: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !isJsonValue(value)) {
    return null;
  }

  const result = value as Record<string, unknown>;
  const visitorId = typeof result.visitorId === "string" ? result.visitorId.trim() : "";
  const confidence = result.confidence;
  const components = result.components;
  const version = result.version;

  if (
    !/^[a-zA-Z0-9_-]{8,128}$/.test(visitorId)
    || !confidence
    || typeof confidence !== "object"
    || Array.isArray(confidence)
    || typeof (confidence as Record<string, unknown>).score !== "number"
    || !Number.isFinite((confidence as Record<string, unknown>).score)
    || !components
    || typeof components !== "object"
    || Array.isArray(components)
    || typeof version !== "string"
    || version.length > 128
  ) {
    return null;
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(result);
  } catch {
    return null;
  }

  if (Buffer.byteLength(serialized, "utf8") > MAX_FINGERPRINT_RESULT_BYTES) return null;
  return { visitorId, serialized };
}

function normalizeBrowserToolResult(value: unknown): { serialized: string; clientIp: string | null } | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !isJsonValue(value)) {
    return null;
  }

  const result = value as Record<string, unknown>;
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, "utf8") > MAX_BROWSER_TOOL_RESULT_BYTES) return null;
  return { serialized, clientIp: normalizeIpAddress(result.ip) };
}

export function parseTelemetryPayload(value: unknown): TelemetryPayload | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const eventName = input.eventName;
  const consentVersion = typeof input.consentVersion === "string" ? input.consentVersion : "";
  const path = normalizePath(input.path);
  const fingerprint = normalizeFingerprintResult(input.fingerprintResult);
  const browserTool = normalizeBrowserToolResult(input.browserToolResult);
  const declaredClientIp = normalizeIpAddress(input.clientIp);

  if (
    !fingerprint
    || !browserTool
    || eventName !== "page_view"
    || !path
    || consentVersion !== TELEMETRY_CONSENT_VERSION
  ) {
    return null;
  }

  return {
    eventName,
    consentVersion,
    visitorId: fingerprint.visitorId,
    fingerprintResult: fingerprint.serialized,
    browserToolResult: browserTool.serialized,
    clientIp: browserTool.clientIp || declaredClientIp,
    path,
    language: normalizeLanguage(input.language),
    viewportBucket: normalizeViewportBucket(input.viewportBucket),
  };
}

export function getTelemetryRetentionDays(): number {
  const configured = Number(process.env.TELEMETRY_RETENTION_DAYS);
  return Number.isFinite(configured) && configured >= 1
    ? Math.min(Math.floor(configured), 3650)
    : DEFAULT_TELEMETRY_RETENTION_DAYS;
}

export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  let originUrl: URL;
  let requestUrl: URL;
  try {
    originUrl = new URL(origin);
    requestUrl = new URL(request.url);
  } catch {
    return false;
  }

  if (originUrl.origin === requestUrl.origin) return true;

  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  return (
    originUrl.protocol === requestUrl.protocol
    && originUrl.port === requestUrl.port
    && localHosts.has(originUrl.hostname)
    && localHosts.has(requestUrl.hostname)
  );
}
