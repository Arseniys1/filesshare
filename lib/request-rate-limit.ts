import crypto from "node:crypto";
import type { Headers } from "undici";
import { clearAccessAttempts, consumeAccessAttempt } from "@/lib/db";

export const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;

export function getRequestIp(headers: Headers): string {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded.slice(0, 128);
  }
  return "direct";
}

export function makeRateKey(scope: string, value: string): string {
  const digest = crypto.createHash("sha256").update(value).digest("hex");
  return `${scope}:${digest}`;
}

export function consumeRequestRateLimit(
  scope: string,
  value: string,
  maxAttempts: number,
  windowMs = AUTH_RATE_WINDOW_MS,
): { allowed: boolean; retryAfterSeconds: number; key: string } {
  const key = makeRateKey(scope, value);
  return { ...consumeAccessAttempt(key, maxAttempts, windowMs), key };
}

export function clearRequestRateLimit(key: string): void {
  clearAccessAttempts(key);
}
