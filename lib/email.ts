import nodemailer from "nodemailer";

function getSmtpPort(): number {
  const port = Number(process.env.SMTP_PORT || "587");
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 587;
}

export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim());
}

async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !from) {
    if (process.env.NODE_ENV === "production") throw new Error("SMTP_HOST and SMTP_FROM must be set in production");
    console.info(`[email] ${to}: ${subject}\n${text}`);
    return;
  }
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  const transporter = nodemailer.createTransport({
    host,
    port: getSmtpPort(),
    secure: getSmtpPort() === 465,
    ...(user && password ? { auth: { user, pass: password } } : {}),
  });
  await transporter.sendMail({ from, to, subject, text });
}

export async function sendPasswordResetEmail(
  email: string,
  resetUrl: string
): Promise<boolean> {
  await sendMail(email, "Восстановление пароля FileShare", [
      "Вы запросили восстановление пароля FileShare.",
      "",
      `Откройте ссылку в течение часа: ${resetUrl}`,
      "",
      "Если вы не запрашивали восстановление, просто проигнорируйте это письмо.",
    ].join("\n"));
  return isSmtpConfigured();
}

export async function sendFileNotificationEmail(
  email: string,
  kind: string,
  payload: { fileName?: string; shareUrl?: string; downloads?: number; expiresAt?: string | null; message?: string }
): Promise<void> {
  const labels: Record<string, string> = {
    upload_completed: "Файл загружен",
    file_downloaded: "Файл скачан",
    expiry_warning: "Ссылка скоро истечёт",
    transfer_expired: "Срок действия ссылки истёк",
    deletion_completed: "Файл удалён",
    deletion_failed: "Не удалось удалить файл",
  };
  await sendMail(email, `FileShare: ${labels[kind] || "Уведомление"}`, [
    payload.message || labels[kind] || "Изменение передачи",
    payload.fileName ? `Файл: ${payload.fileName}` : "",
    payload.downloads !== undefined ? `Скачиваний: ${payload.downloads}` : "",
    payload.expiresAt ? `Действует до: ${payload.expiresAt}` : "",
    payload.shareUrl ? `Ссылка: ${payload.shareUrl}` : "",
  ].filter(Boolean).join("\n"));
}
