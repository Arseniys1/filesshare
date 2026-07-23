import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");
const DATA_DIR =
  process.env.NODE_ENV === "test"
    ? process.env.FILESHARE_DATA_DIR?.trim() || DEFAULT_DATA_DIR
    : DEFAULT_DATA_DIR;
const DB_PATH = path.join(DATA_DIR, "filesshare.db");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS storage_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    bot_token TEXT NOT NULL UNIQUE,
    channel_id TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    files_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    storage_account_id INTEGER NOT NULL,
    telegram_file_id TEXT NOT NULL,
    telegram_message_id INTEGER NOT NULL,
    expires_at TEXT,
    download_count INTEGER NOT NULL DEFAULT 0,
    max_downloads INTEGER,
    password_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (storage_account_id) REFERENCES storage_accounts(id)
  );

  CREATE INDEX IF NOT EXISTS idx_files_token ON files(token);
  CREATE INDEX IF NOT EXISTS idx_files_expires ON files(expires_at);

  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

interface Migration {
  id: string;
  apply: () => void;
}

function hasColumn(table: string, column: string): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`)
      .get(table, column) !== undefined
  );
}

const migrations: Migration[] = [
  {
    id: "001_file_cleanup_state",
    apply: () => {
      if (!hasColumn("files", "deletion_attempts")) {
        db.exec("ALTER TABLE files ADD COLUMN deletion_attempts INTEGER NOT NULL DEFAULT 0");
      }
      if (!hasColumn("files", "last_deletion_error")) {
        db.exec("ALTER TABLE files ADD COLUMN last_deletion_error TEXT");
      }
    },
  },
  {
    id: "002_upload_rate_limits",
    apply: () => {
      db.exec(`
      CREATE TABLE IF NOT EXISTS upload_rate_windows (
        ip TEXT NOT NULL,
        window_name TEXT NOT NULL,
        bucket_start INTEGER NOT NULL,
        upload_count INTEGER NOT NULL DEFAULT 0,
        bytes_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ip, window_name, bucket_start)
      );

      CREATE TABLE IF NOT EXISTS upload_leases (
        ip TEXT PRIMARY KEY,
        active_uploads INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_upload_rate_windows_age
        ON upload_rate_windows(bucket_start);
      `);
    },
  },
  {
    id: "003_upload_rate_reservations",
    apply: () => {
      if (!hasColumn("upload_rate_windows", "reserved_bytes")) {
        db.exec(
          "ALTER TABLE upload_rate_windows ADD COLUMN reserved_bytes INTEGER NOT NULL DEFAULT 0"
        );
      }
    },
  },
];

db.exec("BEGIN IMMEDIATE");
try {
  for (const migration of migrations) {
    const applied = db
      .prepare("SELECT 1 FROM schema_migrations WHERE id = ?")
      .get(migration.id);
    if (applied) continue;

    migration.apply();
    db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(migration.id);
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

export interface StorageAccount {
  id: number;
  name: string;
  bot_token: string;
  channel_id: string;
  is_active: number;
  files_count: number;
  created_at: string;
}

export interface FileRecord {
  id: number;
  token: string;
  original_name: string;
  mime_type: string;
  size: number;
  storage_account_id: number;
  telegram_file_id: string;
  telegram_message_id: number;
  expires_at: string | null;
  download_count: number;
  max_downloads: number | null;
  password_hash: string | null;
  created_at: string;
  deletion_attempts: number;
  last_deletion_error: string | null;
}

export interface FileWithAccount extends FileRecord {
  bot_token: string;
  channel_id: string;
  account_name: string;
}

export function getActiveStorageAccounts(): StorageAccount[] {
  return db
    .prepare("SELECT * FROM storage_accounts WHERE is_active = 1 ORDER BY files_count ASC")
    .all() as StorageAccount[];
}

export function getAllStorageAccounts(): StorageAccount[] {
  return db
    .prepare("SELECT * FROM storage_accounts ORDER BY created_at DESC")
    .all() as StorageAccount[];
}

export function getStorageAccountById(id: number): StorageAccount | undefined {
  return db
    .prepare("SELECT * FROM storage_accounts WHERE id = ?")
    .get(id) as StorageAccount | undefined;
}

export function createStorageAccount(
  name: string,
  botToken: string,
  channelId: string
): StorageAccount {
  const result = db
    .prepare(
      "INSERT INTO storage_accounts (name, bot_token, channel_id) VALUES (?, ?, ?)"
    )
    .run(name, botToken, channelId);

  return getStorageAccountById(result.lastInsertRowid as number)!;
}

export function updateStorageAccount(
  id: number,
  data: { name?: string; is_active?: boolean }
): void {
  if (data.name !== undefined) {
    db.prepare("UPDATE storage_accounts SET name = ? WHERE id = ?").run(data.name, id);
  }
  if (data.is_active !== undefined) {
    db.prepare("UPDATE storage_accounts SET is_active = ? WHERE id = ?").run(
      data.is_active ? 1 : 0,
      id
    );
  }
}

export function getStorageAccountFileCount(id: number): number {
  return (
    db
      .prepare("SELECT COUNT(*) as count FROM files WHERE storage_account_id = ?")
      .get(id) as { count: number }
  ).count;
}

export function deleteStorageAccount(id: number): boolean {
  return db.prepare("DELETE FROM storage_accounts WHERE id = ?").run(id).changes > 0;
}

export function incrementAccountFileCount(id: number): void {
  db.prepare(
    "UPDATE storage_accounts SET files_count = files_count + 1 WHERE id = ?"
  ).run(id);
}

export function createFileRecord(data: {
  token: string;
  originalName: string;
  mimeType: string;
  size: number;
  storageAccountId: number;
  telegramFileId: string;
  telegramMessageId: number;
  expiresAt: string | null;
  maxDownloads: number | null;
  passwordHash: string | null;
}): FileRecord {
  const create = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO files (
          token, original_name, mime_type, size, storage_account_id,
          telegram_file_id, telegram_message_id, expires_at, max_downloads, password_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.token,
        data.originalName,
        data.mimeType,
        data.size,
        data.storageAccountId,
        data.telegramFileId,
        data.telegramMessageId,
        data.expiresAt,
        data.maxDownloads,
        data.passwordHash
      );

    incrementAccountFileCount(data.storageAccountId);
    return db
      .prepare("SELECT * FROM files WHERE id = ?")
      .get(result.lastInsertRowid) as FileRecord;
  });

  return create();
}

export function getFileByToken(token: string): FileWithAccount | undefined {
  return db
    .prepare(
      `SELECT f.*, s.bot_token, s.channel_id, s.name as account_name
       FROM files f
       JOIN storage_accounts s ON f.storage_account_id = s.id
       WHERE f.token = ?`
    )
    .get(token) as FileWithAccount | undefined;
}

export function updateFilePasswordHash(token: string, passwordHash: string): void {
  db.prepare("UPDATE files SET password_hash = ? WHERE token = ?").run(passwordHash, token);
}

/** Atomically reserves one download slot. Call releaseDownloadReservation on upstream failure. */
export function reserveDownload(token: string): boolean {
  return (
    db
      .prepare(
        `UPDATE files
         SET download_count = download_count + 1
         WHERE token = ?
           AND (max_downloads IS NULL OR download_count < max_downloads)`
      )
      .run(token).changes === 1
  );
}

export function releaseDownloadReservation(token: string): void {
  db.prepare(
    "UPDATE files SET download_count = MAX(download_count - 1, 0) WHERE token = ?"
  ).run(token);
}

export function getRecentFiles(limit = 20): FileRecord[] {
  return db
    .prepare("SELECT * FROM files ORDER BY created_at DESC LIMIT ?")
    .all(limit) as FileRecord[];
}

export function getExpiredFilesForCleanup(limit = 100): FileWithAccount[] {
  return db
    .prepare(
      `SELECT f.*, s.bot_token, s.channel_id, s.name as account_name
       FROM files f
       JOIN storage_accounts s ON f.storage_account_id = s.id
       WHERE f.expires_at IS NOT NULL
         AND julianday(f.expires_at) <= julianday('now')
       ORDER BY f.expires_at ASC
       LIMIT ?`
    )
    .all(limit) as FileWithAccount[];
}

export function deleteExpiredFileRecord(token: string): void {
  db.transaction(() => {
    const file = db
      .prepare("SELECT storage_account_id FROM files WHERE token = ?")
      .get(token) as { storage_account_id: number } | undefined;
    if (!file) return;

    db.prepare("DELETE FROM files WHERE token = ?").run(token);
    db.prepare(
      "UPDATE storage_accounts SET files_count = MAX(files_count - 1, 0) WHERE id = ?"
    ).run(file.storage_account_id);
  })();
}

export function markFileDeletionFailed(token: string, error: string): void {
  db.prepare(
    `UPDATE files
     SET deletion_attempts = deletion_attempts + 1,
         last_deletion_error = ?
     WHERE token = ?`
  ).run(error.slice(0, 1000), token);
}

export function getStats() {
  const totalFiles = (
    db.prepare("SELECT COUNT(*) as count FROM files").get() as { count: number }
  ).count;
  const totalSize = (
    db.prepare("SELECT COALESCE(SUM(size), 0) as total FROM files").get() as {
      total: number;
    }
  ).total;
  const activeAccounts = (
    db
      .prepare("SELECT COUNT(*) as count FROM storage_accounts WHERE is_active = 1")
      .get() as { count: number }
  ).count;
  const expiredFiles = (
    db
      .prepare(
        "SELECT COUNT(*) as count FROM files WHERE expires_at IS NOT NULL AND julianday(expires_at) < julianday('now')"
      )
      .get() as { count: number }
  ).count;

  return { totalFiles, totalSize, activeAccounts, expiredFiles };
}

export default db;
