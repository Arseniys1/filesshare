import nodemailer from "nodemailer";

function getSmtpPort(): number {
  const port = Number(process.env.SMTP_PORT || "587");
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 587;
}

export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim());
}

export async function sendPasswordResetEmail(
  email: string,
  resetUrl: string
): Promise<boolean> {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();

  if (!host || !from) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMTP_HOST and SMTP_FROM must be set in production");
    }
    console.info(`[auth] Password reset link for ${email}: ${resetUrl}`);
    return false;
  }

  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  const transporter = nodemailer.createTransport({
    host,
    port: getSmtpPort(),
    secure: getSmtpPort() === 465,
    ...(user && password ? { auth: { user, pass: password } } : {}),
  });

  await transporter.sendMail({
    from,
    to: email,
    subject: "Восстановление пароля FileShare",
    text: [
      "Вы запросили восстановление пароля FileShare.",
      "",
      `Откройте ссылку в течение часа: ${resetUrl}`,
      "",
      "Если вы не запрашивали восстановление, просто проигнорируйте это письмо.",
    ].join("\n"),
  });

  return true;
}
