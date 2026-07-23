import db from "@/lib/db";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_UPLOADS_PER_HOUR = 30;
const MAX_BYTES_PER_DAY = 100 * 1024 * 1024 * 1024;
const MAX_ACTIVE_UPLOADS = 3;
const LEASE_TTL_MS = 35 * 60 * 1000;

export class UploadRateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("Лимит загрузок для вашего IP-адреса временно исчерпан");
    this.name = "UploadRateLimitError";
  }
}

export interface UploadLease {
  ip: string;
  startedAt: number;
  reservedBytes: number;
}

function bucketStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

function secondsUntilWindowEnd(now: number, windowMs: number): number {
  return Math.max(1, Math.ceil((bucketStart(now, windowMs) + windowMs - now) / 1000));
}

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (process.env.TRUST_PROXY === "1" && forwarded) {
    const ip = forwarded.split(",")[0]?.trim();
    if (ip) return ip.slice(0, 64);
  }
  return "direct";
}

export function acquireUploadLease(ip: string, expectedBytes = 0): UploadLease {
  const now = Date.now();
  const hourStart = bucketStart(now, HOUR_MS);
  const dayStart = bucketStart(now, DAY_MS);

  return db.transaction(() => {
    db.prepare("DELETE FROM upload_rate_windows WHERE bucket_start < ?").run(
      dayStart - DAY_MS
    );
    db.prepare(
      "UPDATE upload_leases SET active_uploads = 0 WHERE updated_at < ?"
    ).run(now - LEASE_TTL_MS);

    for (const [windowName, start] of [
      ["hour", hourStart],
      ["day", dayStart],
    ] as const) {
      db.prepare(
        `INSERT OR IGNORE INTO upload_rate_windows (ip, window_name, bucket_start)
         VALUES (?, ?, ?)`
      ).run(ip, windowName, start);
    }

    const hour = db
      .prepare(
        `SELECT upload_count FROM upload_rate_windows
         WHERE ip = ? AND window_name = 'hour' AND bucket_start = ?`
      )
      .get(ip, hourStart) as { upload_count: number };
    const day = db
      .prepare(
        `SELECT bytes_count, reserved_bytes FROM upload_rate_windows
         WHERE ip = ? AND window_name = 'day' AND bucket_start = ?`
      )
      .get(ip, dayStart) as { bytes_count: number; reserved_bytes: number };
    const lease = db
      .prepare("SELECT active_uploads FROM upload_leases WHERE ip = ?")
      .get(ip) as { active_uploads: number } | undefined;

    if (hour.upload_count >= MAX_UPLOADS_PER_HOUR) {
      throw new UploadRateLimitError(secondsUntilWindowEnd(now, HOUR_MS));
    }
    if (day.bytes_count + day.reserved_bytes + expectedBytes > MAX_BYTES_PER_DAY) {
      throw new UploadRateLimitError(secondsUntilWindowEnd(now, DAY_MS));
    }
    if ((lease?.active_uploads ?? 0) >= MAX_ACTIVE_UPLOADS) {
      throw new UploadRateLimitError(60);
    }

    db.prepare(
      `INSERT INTO upload_leases (ip, active_uploads, updated_at)
       VALUES (?, 1, ?)
       ON CONFLICT(ip) DO UPDATE SET
         active_uploads = upload_leases.active_uploads + 1,
         updated_at = excluded.updated_at`
    ).run(ip, now);

    db.prepare(
      `UPDATE upload_rate_windows
       SET reserved_bytes = reserved_bytes + ?
       WHERE ip = ? AND window_name = 'day' AND bucket_start = ?`
    ).run(expectedBytes, ip, dayStart);

    return { ip, startedAt: now, reservedBytes: expectedBytes };
  })();
}

function releaseLease(lease: UploadLease, keepBytes = false): void {
  db.prepare(
    `UPDATE upload_leases
     SET active_uploads = MAX(active_uploads - 1, 0), updated_at = ?
     WHERE ip = ?`
  ).run(Date.now(), lease.ip);
  if (!keepBytes) {
    const dayStart = bucketStart(lease.startedAt, DAY_MS);
    db.prepare(
      `UPDATE upload_rate_windows
       SET reserved_bytes = MAX(reserved_bytes - ?, 0)
       WHERE ip = ? AND window_name = 'day' AND bucket_start = ?`
    ).run(lease.reservedBytes, lease.ip, dayStart);
  }
}

export function finishUploadLease(lease: UploadLease, size: number): void {
  const hourStart = bucketStart(lease.startedAt, HOUR_MS);
  const dayStart = bucketStart(lease.startedAt, DAY_MS);

  db.transaction(() => {
    releaseLease(lease, true);
    db.prepare(
      `UPDATE upload_rate_windows
       SET upload_count = upload_count + 1, bytes_count = bytes_count + ?
       WHERE ip = ? AND window_name = 'hour' AND bucket_start = ?`
    ).run(size, lease.ip, hourStart);
    db.prepare(
      `UPDATE upload_rate_windows
       SET bytes_count = bytes_count + ?,
           reserved_bytes = MAX(reserved_bytes - ?, 0)
       WHERE ip = ? AND window_name = 'day' AND bucket_start = ?`
    ).run(size, lease.reservedBytes, lease.ip, dayStart);
  })();
}

export function abandonUploadLease(lease: UploadLease): void {
  releaseLease(lease);
}

export const uploadRateLimits = {
  maxUploadsPerHour: MAX_UPLOADS_PER_HOUR,
  maxBytesPerDay: MAX_BYTES_PER_DAY,
  maxConcurrentUploads: MAX_ACTIVE_UPLOADS,
};
