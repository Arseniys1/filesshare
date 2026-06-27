import { nanoid } from "nanoid";
import crypto from "crypto";

export function generateFileToken(): string {
  return nanoid(12);
}

export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("ru-RU", {
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
