import { nanoid } from "nanoid";
import crypto from "crypto";

export interface PasswordVerification {
  valid: boolean;
  needsRehash: boolean;
}

function derivePassword(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, length, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

export function generateFileToken(): string {
  return nanoid(12);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await derivePassword(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

function safelyCompare(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<PasswordVerification> {
  const [algorithm, saltEncoded, hashEncoded] = storedHash.split("$");

  if (algorithm === "scrypt" && saltEncoded && hashEncoded) {
    try {
      const expected = Buffer.from(hashEncoded, "base64url");
      const actual = await derivePassword(
        password,
        Buffer.from(saltEncoded, "base64url"),
        expected.length
      );
      return { valid: safelyCompare(actual, expected), needsRehash: false };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  // Compatibility with links created before the scrypt migration.
  const legacy = crypto.createHash("sha256").update(password).digest();
  const expected = Buffer.from(storedHash, "hex");
  return {
    valid: safelyCompare(legacy, expected),
    needsRehash: safelyCompare(legacy, expected),
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDate(dateStr: string, locale = "ru-RU"): string {
  return new Date(dateStr).toLocaleString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

export function computeExpiresAt(
  expiryOption: string
): string | null {
  const now = new Date();

  switch (expiryOption) {
    case "1h":
      return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    case "24h":
      return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    case "7d":
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    case "30d":
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    case "never":
    default:
      return null;
  }
}

export const EXPIRY_OPTIONS = [
  { value: "1h", label: "1 час" },
  { value: "24h", label: "24 часа" },
  { value: "7d", label: "7 дней" },
  { value: "30d", label: "30 дней" },
  { value: "never", label: "Без ограничения" },
] as const;

export function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.startsWith("video/")) return "🎬";
  if (mimeType.startsWith("audio/")) return "🎵";
  if (mimeType.includes("pdf")) return "📄";
  if (mimeType.includes("zip") || mimeType.includes("rar")) return "📦";
  if (mimeType.includes("text") || mimeType.includes("json")) return "📝";
  return "📎";
}
