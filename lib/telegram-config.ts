const CLOUD_MAX_BYTES = 50 * 1024 * 1024;
const LOCAL_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export function isLocalTelegramApi(): boolean {
  const base = process.env.TELEGRAM_API_BASE?.trim();
  return !!base && base !== "https://api.telegram.org";
}

export function getTelegramApiBase(): string {
  return (
    process.env.TELEGRAM_API_BASE?.trim().replace(/\/$/, "") ||
    "https://api.telegram.org"
  );
}

export function getMaxFileSizeBytes(): number {
  return isLocalTelegramApi() ? LOCAL_MAX_BYTES : CLOUD_MAX_BYTES;
}

export function getMaxFileSizeLabel(): string {
  return isLocalTelegramApi() ? "2 ГБ" : "50 МБ";
}

export function buildBotApiUrl(botToken: string, method: string): string {
  return `${getTelegramApiBase()}/bot${botToken}/${method}`;
}

export function buildFileApiUrl(botToken: string, filePath: string): string {
  return `${getTelegramApiBase()}/file/bot${botToken}/${filePath}`;
}

export function toTelegramFileUri(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(normalized)) {
    return `file:///${normalized}`;
  }
  return `file://${normalized}`;
}
