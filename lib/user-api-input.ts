import { EXPIRY_OPTIONS } from "@/lib/utils";

export function parseMaxDownloads(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+$/.test(String(value))) {
    throw new Error("Лимит скачиваний должен быть целым числом");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
    throw new Error("Лимит скачиваний должен быть от 1 до 1 000 000");
  }
  return parsed;
}

export function parseExpiry(value: unknown, defaultValue = "never"): string {
  const expiry = value === undefined ? defaultValue : value;
  if (typeof expiry !== "string" || !EXPIRY_OPTIONS.some((option) => option.value === expiry)) {
    throw new Error("Некорректный срок действия ссылки");
  }
  return expiry;
}

export function parseOptionalPassword(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 1024) throw new Error("Пароль слишком длинный");
  return value;
}
