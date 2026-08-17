import { getPendingNotifications, markNotificationFailed, markNotificationSent } from "@/lib/db";
import { sendFileNotificationEmail } from "@/lib/email";

export async function processNotificationOutbox(limit = 20): Promise<{ sent: number; failed: number }> {
  const pending = getPendingNotifications(limit);
  let sent = 0;
  let failed = 0;
  for (const notification of pending) {
    try {
      const payload = JSON.parse(notification.payload) as {
        fileName?: string;
        shareUrl?: string;
        downloads?: number;
        expiresAt?: string | null;
        message?: string;
      };
      await sendFileNotificationEmail(notification.email, notification.kind, payload);
      markNotificationSent(notification.id);
      sent += 1;
    } catch (error) {
      markNotificationFailed(notification.id, error instanceof Error ? error.message : "Ошибка отправки письма");
      failed += 1;
    }
  }
  return { sent, failed };
}
