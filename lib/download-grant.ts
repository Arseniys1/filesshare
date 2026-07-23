import crypto from "node:crypto";

const GRANT_TTL_SECONDS = 5 * 60;

function getSecret(): string {
  const secret = process.env.DOWNLOAD_GRANT_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("DOWNLOAD_GRANT_SECRET must be set in production");
  }
  return "development-only-download-grant-secret";
}

function signature(token: string, expiresAt: number): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(`v1:${token}:${expiresAt}`)
    .digest("base64url");
}

function safelyCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function isSafeFileToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/.test(token);
}

export function getDownloadGrantCookieName(token: string): string {
  if (!isSafeFileToken(token)) throw new Error("Invalid file token");
  return `fs_download_${token}`;
}

export function createDownloadGrant(token: string): {
  value: string;
  expiresAt: Date;
} {
  const expiresAt = Math.floor(Date.now() / 1000) + GRANT_TTL_SECONDS;
  return {
    value: `${expiresAt}.${signature(token, expiresAt)}`,
    expiresAt: new Date(expiresAt * 1000),
  };
}

export function verifyDownloadGrant(token: string, value: string | undefined): boolean {
  if (!value) return false;
  const [expiresAtText, actualSignature] = value.split(".");
  const expiresAt = Number(expiresAtText);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < Math.floor(Date.now() / 1000) ||
    !actualSignature
  ) {
    return false;
  }
  return safelyCompare(actualSignature, signature(token, expiresAt));
}
