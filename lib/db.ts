import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "filesshare.db");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

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
`);

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

export function deleteStorageAccount(id: number): void {
  db.prepare("DELETE FROM storage_accounts WHERE id = ?").run(id);
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

export function incrementDownloadCount(token: string): void {
  db.prepare(
    "UPDATE files SET download_count = download_count + 1 WHERE token = ?"
  ).run(token);
}

export function getRecentFiles(limit = 20): FileRecord[] {
  return db
    .prepare("SELECT * FROM files ORDER BY created_at DESC LIMIT ?")
    .all(limit) as FileRecord[];
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
        "SELECT COUNT(*) as count FROM files WHERE expires_at IS NOT NULL AND expires_at < datetime('now')"
      )
      .get() as { count: number }
  ).count;

  return { totalFiles, totalSize, activeAccounts, expiredFiles };
}

export default db;
