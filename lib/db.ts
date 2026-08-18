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

      CREATE TABLE IF NOT EXISTS file_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER,
    expires_at TEXT,
    download_count INTEGER NOT NULL DEFAULT 0,
    max_downloads INTEGER,
    password_hash TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    content_size INTEGER NOT NULL DEFAULT 0,
    storage_account_id INTEGER NOT NULL,
    telegram_file_id TEXT NOT NULL,
    telegram_message_id INTEGER NOT NULL,
    owner_user_id INTEGER,
    expires_at TEXT,
    download_count INTEGER NOT NULL DEFAULT 0,
    max_downloads INTEGER,
    password_hash TEXT,
    storage_encryption TEXT NOT NULL DEFAULT 'none',
    storage_key_wrap TEXT,
    content_encryption TEXT NOT NULL DEFAULT 'none',
    group_id INTEGER,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (storage_account_id) REFERENCES storage_accounts(id),
    FOREIGN KEY (group_id) REFERENCES file_groups(id) ON DELETE CASCADE
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
  {
    id: "004_user_authentication",
    apply: () => {
      db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        used_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
        ON password_reset_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
        ON password_reset_tokens(expires_at);
      `);
    },
  },
  {
    id: "005_file_encryption_layers",
    apply: () => {
      if (!hasColumn("files", "content_size")) {
        db.exec("ALTER TABLE files ADD COLUMN content_size INTEGER NOT NULL DEFAULT 0");
      }
      if (!hasColumn("files", "storage_encryption")) {
        db.exec("ALTER TABLE files ADD COLUMN storage_encryption TEXT NOT NULL DEFAULT 'none'");
      }
      if (!hasColumn("files", "storage_key_wrap")) {
        db.exec("ALTER TABLE files ADD COLUMN storage_key_wrap TEXT");
      }
      if (!hasColumn("files", "content_encryption")) {
        db.exec("ALTER TABLE files ADD COLUMN content_encryption TEXT NOT NULL DEFAULT 'none'");
      }
      db.exec("UPDATE files SET content_size = size WHERE content_size = 0");
    },
  },
  {
    id: "006_file_groups",
    apply: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS file_groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          token TEXT NOT NULL UNIQUE,
          expires_at TEXT,
          download_count INTEGER NOT NULL DEFAULT 0,
          max_downloads INTEGER,
          password_hash TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      if (!hasColumn("files", "group_id")) {
        db.exec(
          "ALTER TABLE files ADD COLUMN group_id INTEGER REFERENCES file_groups(id) ON DELETE CASCADE"
        );
      }
      db.exec("CREATE INDEX IF NOT EXISTS idx_files_group_id ON files(group_id)");
    },
  },
  {
    id: "007_file_ownership_and_events",
    apply: () => {
      if (!hasColumn("files", "owner_user_id")) {
        db.exec("ALTER TABLE files ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL");
      }
      if (!hasColumn("files", "revoked_at")) {
        db.exec("ALTER TABLE files ADD COLUMN revoked_at TEXT");
      }
      if (!hasColumn("file_groups", "owner_user_id")) {
        db.exec("ALTER TABLE file_groups ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL");
      }
      if (!hasColumn("file_groups", "revoked_at")) {
        db.exec("ALTER TABLE file_groups ADD COLUMN revoked_at TEXT");
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_files_owner_created
          ON files(owner_user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_groups_owner_created
          ON file_groups(owner_user_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS download_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          file_id INTEGER NOT NULL,
          group_id INTEGER,
          outcome TEXT NOT NULL DEFAULT 'started'
            CHECK (outcome IN ('started', 'failed')),
          ip_hash TEXT,
          user_agent TEXT,
          is_group_download INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
          FOREIGN KEY (group_id) REFERENCES file_groups(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_download_events_file_created
          ON download_events(file_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_download_events_group_created
          ON download_events(group_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS user_notification_settings (
          user_id INTEGER PRIMARY KEY,
          email_enabled INTEGER NOT NULL DEFAULT 1,
          download_notifications INTEGER NOT NULL DEFAULT 1,
          summary_notifications INTEGER NOT NULL DEFAULT 0,
          expiry_warning_days INTEGER NOT NULL DEFAULT 2,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS notification_outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          kind TEXT NOT NULL,
          payload TEXT NOT NULL,
          dedupe_key TEXT UNIQUE,
          available_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          sent_at INTEGER,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending
          ON notification_outbox(sent_at, available_at);
      `);
    },
  },
  {
    id: "008_upload_sessions",
    apply: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS upload_sessions (
          id TEXT PRIMARY KEY,
          owner_user_id INTEGER,
          anonymous_token TEXT,
          file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          total_size INTEGER NOT NULL,
          chunk_size INTEGER NOT NULL,
          total_chunks INTEGER NOT NULL,
          checksum TEXT,
          content_encryption TEXT NOT NULL DEFAULT 'none',
          original_size INTEGER,
          expiry TEXT NOT NULL DEFAULT 'never',
          expires_at TEXT,
          max_downloads INTEGER,
          password_hash TEXT,
          group_token TEXT,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'assembling', 'completed', 'failed', 'cancelled')),
          upload_root TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          completed_at INTEGER,
          result_json TEXT,
          FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS upload_session_parts (
          session_id TEXT NOT NULL,
          part_index INTEGER NOT NULL,
          size INTEGER NOT NULL,
          checksum TEXT NOT NULL,
          path TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (session_id, part_index),
          FOREIGN KEY (session_id) REFERENCES upload_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_upload_sessions_status_updated
          ON upload_sessions(status, updated_at);
      `);
    },
  },
  {
    id: "009_user_limits",
    apply: () => {
      if (!hasColumn("users", "blocked_at")) db.exec("ALTER TABLE users ADD COLUMN blocked_at TEXT");
      if (!hasColumn("users", "max_file_size")) db.exec("ALTER TABLE users ADD COLUMN max_file_size INTEGER");
      if (!hasColumn("users", "storage_limit")) db.exec("ALTER TABLE users ADD COLUMN storage_limit INTEGER");
      if (!hasColumn("users", "active_link_limit")) db.exec("ALTER TABLE users ADD COLUMN active_link_limit INTEGER");
      if (!hasColumn("users", "max_downloads")) db.exec("ALTER TABLE users ADD COLUMN max_downloads INTEGER");
      if (!hasColumn("users", "max_parallel_uploads")) db.exec("ALTER TABLE users ADD COLUMN max_parallel_uploads INTEGER");
    },
  },
  {
    id: "010_access_variants",
    apply: () => {
      if (!hasColumn("files", "pin_hash")) db.exec("ALTER TABLE files ADD COLUMN pin_hash TEXT");
      if (!hasColumn("files", "one_time")) db.exec("ALTER TABLE files ADD COLUMN one_time INTEGER NOT NULL DEFAULT 0");
      if (!hasColumn("files", "used_at")) db.exec("ALTER TABLE files ADD COLUMN used_at TEXT");
      if (!hasColumn("file_groups", "pin_hash")) db.exec("ALTER TABLE file_groups ADD COLUMN pin_hash TEXT");
      if (!hasColumn("file_groups", "one_time")) db.exec("ALTER TABLE file_groups ADD COLUMN one_time INTEGER NOT NULL DEFAULT 0");
      if (!hasColumn("file_groups", "used_at")) db.exec("ALTER TABLE file_groups ADD COLUMN used_at TEXT");
      db.exec(`
        CREATE TABLE IF NOT EXISTS short_links (
          code TEXT PRIMARY KEY,
          target_token TEXT NOT NULL UNIQUE,
          owner_user_id INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_short_links_owner ON short_links(owner_user_id);
      `);
    },
  },
  {
    id: "011_upload_access_options",
    apply: () => {
      if (!hasColumn("upload_sessions", "pin_hash")) db.exec("ALTER TABLE upload_sessions ADD COLUMN pin_hash TEXT");
      if (!hasColumn("upload_sessions", "one_time")) db.exec("ALTER TABLE upload_sessions ADD COLUMN one_time INTEGER NOT NULL DEFAULT 0");
    },
  },
  {
    id: "012_user_upload_leases",
    apply: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_upload_leases (
          user_id INTEGER PRIMARY KEY,
          active_uploads INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    id: "013_deletion_progress",
    apply: () => {
      if (!hasColumn("files", "telegram_deleted_at")) db.exec("ALTER TABLE files ADD COLUMN telegram_deleted_at TEXT");
    },
  },
  {
    id: "014_access_rate_limits",
    apply: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS access_rate_limits (
          rate_key TEXT PRIMARY KEY,
          window_started_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          blocked_until INTEGER
        );
      `);
    },
  },
  {
    id: "015_admin_audit_log",
    apply: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS admin_audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          admin_user_id INTEGER NOT NULL,
          action TEXT NOT NULL,
          target_type TEXT NOT NULL,
          target_id TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_events(created_at DESC);
      `);
    },
  },
  {
    id: "016_recipient_limits",
    apply: () => {
      if (!hasColumn("files", "max_recipients")) db.exec("ALTER TABLE files ADD COLUMN max_recipients INTEGER");
      if (!hasColumn("files", "recipient_count")) db.exec("ALTER TABLE files ADD COLUMN recipient_count INTEGER NOT NULL DEFAULT 0");
      if (!hasColumn("file_groups", "max_recipients")) db.exec("ALTER TABLE file_groups ADD COLUMN max_recipients INTEGER");
      if (!hasColumn("file_groups", "recipient_count")) db.exec("ALTER TABLE file_groups ADD COLUMN recipient_count INTEGER NOT NULL DEFAULT 0");
      if (!hasColumn("upload_sessions", "max_recipients")) db.exec("ALTER TABLE upload_sessions ADD COLUMN max_recipients INTEGER");
      db.exec(`
        CREATE TABLE IF NOT EXISTS transfer_recipients (
          target_token TEXT NOT NULL,
          recipient_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (target_token, recipient_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_transfer_recipients_created ON transfer_recipients(created_at);
      `);
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

export interface FileGroupRecord {
  id: number;
  token: string;
  owner_user_id: number | null;
  expires_at: string | null;
  download_count: number;
  max_downloads: number | null;
  password_hash: string | null;
  revoked_at: string | null;
  pin_hash: string | null;
  one_time: number;
  used_at: string | null;
  max_recipients: number | null;
  recipient_count: number;
  created_at: string;
}

export type UserRole = "user" | "admin";
export type StorageEncryption = "none" | "server-v1";
export type ContentEncryption = "none" | "e2ee-v1";

export interface UserRecord {
  id: number;
  email: string;
  password_hash: string;
  role: UserRole;
  blocked_at: string | null;
  max_file_size: number | null;
  storage_limit: number | null;
  active_link_limit: number | null;
  max_downloads: number | null;
  max_parallel_uploads: number | null;
  created_at: string;
}

export interface AuthUserRecord {
  id: number;
  email: string;
  role: UserRole;
  blocked_at: string | null;
  created_at: string;
}

export interface AdminUserRecord {
  id: number;
  email: string;
  role: UserRole;
  blocked_at: string | null;
  max_file_size: number | null;
  storage_limit: number | null;
  active_link_limit: number | null;
  max_downloads: number | null;
  max_parallel_uploads: number | null;
  files_count: number;
  storage_used: number;
  created_at: string;
}

export interface AdminFileRecord {
  token: string;
  original_name: string;
  size: number;
  mime_type: string;
  owner_email: string | null;
  group_token: string | null;
  expires_at: string | null;
  download_count: number;
  max_downloads: number | null;
  revoked_at: string | null;
  content_encryption: ContentEncryption;
  created_at: string;
}

export interface AdminPagination<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminAuditEventRecord {
  id: number;
  admin_user_id: number;
  admin_email: string;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: string | null;
  created_at: string;
}

export interface FileRecord {
  id: number;
  token: string;
  original_name: string;
  mime_type: string;
  size: number;
  content_size: number;
  storage_account_id: number;
  telegram_file_id: string;
  telegram_message_id: number;
  owner_user_id: number | null;
  expires_at: string | null;
  download_count: number;
  max_downloads: number | null;
  password_hash: string | null;
  storage_encryption: StorageEncryption;
  storage_key_wrap: string | null;
  content_encryption: ContentEncryption;
  group_id: number | null;
  revoked_at: string | null;
  pin_hash: string | null;
  one_time: number;
  used_at: string | null;
  max_recipients: number | null;
  recipient_count: number;
  created_at: string;
  telegram_deleted_at: string | null;
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

export type DownloadEventOutcome = "started" | "failed";

export interface DownloadEventRecord {
  id: number;
  file_id: number;
  group_id: number | null;
  outcome: DownloadEventOutcome;
  ip_hash: string | null;
  user_agent: string | null;
  is_group_download: number;
  created_at: string;
}

export interface UserNotificationSettings {
  user_id: number;
  email_enabled: number;
  download_notifications: number;
  summary_notifications: number;
  expiry_warning_days: number;
}

export interface UploadSessionRecord {
  id: string;
  owner_user_id: number | null;
  anonymous_token: string | null;
  file_name: string;
  mime_type: string;
  total_size: number;
  chunk_size: number;
  total_chunks: number;
  checksum: string | null;
  content_encryption: ContentEncryption;
  original_size: number | null;
  expiry: string;
  expires_at: string | null;
  max_downloads: number | null;
  password_hash: string | null;
  group_token: string | null;
  status: "active" | "assembling" | "completed" | "failed" | "cancelled";
  upload_root: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  result_json: string | null;
  pin_hash: string | null;
  one_time: number;
  max_recipients: number | null;
}

export interface UploadSessionPartRecord {
  session_id: string;
  part_index: number;
  size: number;
  checksum: string;
  path: string;
  created_at: number;
}

export interface OwnedTransferRecord {
  kind: "file" | "group";
  token: string;
  owner_user_id: number;
  name: string;
  size: number;
  file_count: number;
  expires_at: string | null;
  download_count: number;
  max_downloads: number | null;
  has_password: number;
  has_pin: number;
  storage_encrypted: number;
  content_encryption: ContentEncryption;
  created_at: string;
  revoked_at: string | null;
  one_time: number;
  used_at: string | null;
  max_recipients: number | null;
  recipient_count: number;
}

export interface OwnedTransferDetails {
  kind: "file" | "group";
  token: string;
  group: FileGroupRecord | null;
  file: FileWithAccount | null;
  files: FileWithAccount[];
}

export interface PendingNotification {
  id: number;
  user_id: number;
  email: string;
  kind: string;
  payload: string;
  dedupe_key: string | null;
  available_at: number;
  attempts: number;
}

export function getUserByEmail(email: string): UserRecord | undefined {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email) as UserRecord | undefined;
}

export function getUserById(id: number): UserRecord | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRecord | undefined;
}

export function getUserQuotaUsage(userId: number): { storageUsed: number; activeLinks: number } {
  const storageUsed = (db.prepare("SELECT COALESCE(SUM(size), 0) AS total FROM files WHERE owner_user_id = ?").get(userId) as { total: number }).total;
  const activeLinks = (db.prepare(
    `SELECT COUNT(*) AS count FROM (
       SELECT g.id FROM file_groups g WHERE g.owner_user_id = ? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR julianday(g.expires_at) > julianday('now'))
       UNION ALL
       SELECT f.id FROM files f WHERE f.owner_user_id = ? AND f.group_id IS NULL AND f.revoked_at IS NULL AND (f.expires_at IS NULL OR julianday(f.expires_at) > julianday('now'))
     )`
  ).get(userId, userId) as { count: number }).count;
  return { storageUsed, activeLinks };
}

export function getAllUsers(): AdminUserRecord[] {
  return db.prepare(
    `SELECT u.id, u.email, u.role, u.blocked_at, u.max_file_size, u.storage_limit,
            u.active_link_limit, u.max_downloads, u.max_parallel_uploads, u.created_at,
            COUNT(DISTINCT f.id) AS files_count,
            COALESCE(SUM(f.size), 0) AS storage_used
     FROM users u
     LEFT JOIN files f ON f.owner_user_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC`
  ).all() as AdminUserRecord[];
}

export function getAdminUsersPage(page = 1, limit = 20): AdminPagination<AdminUserRecord> {
  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 100);
  const total = (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
  const users = db.prepare(
    `SELECT u.id, u.email, u.role, u.blocked_at, u.max_file_size, u.storage_limit,
            u.active_link_limit, u.max_downloads, u.max_parallel_uploads, u.created_at,
            COUNT(DISTINCT f.id) AS files_count,
            COALESCE(SUM(f.size), 0) AS storage_used
     FROM users u
     LEFT JOIN files f ON f.owner_user_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(safeLimit, (safePage - 1) * safeLimit) as AdminUserRecord[];

  return {
    items: users,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

export function getAdminFileOverview(query?: string, limit = 100): AdminFileRecord[] {
  const text = query?.trim().toLowerCase();
  const where = text ? "WHERE lower(f.original_name) LIKE ? OR lower(COALESCE(u.email, '')) LIKE ?" : "";
  const values = text ? [`%${text}%`, `%${text}%`, Math.min(Math.max(limit, 1), 500)] : [Math.min(Math.max(limit, 1), 500)];
  return db.prepare(
    `SELECT f.token, f.original_name, f.size, f.mime_type, u.email AS owner_email,
            g.token AS group_token, f.expires_at, f.download_count, f.max_downloads,
            f.revoked_at, f.content_encryption, f.created_at
     FROM files f
     LEFT JOIN users u ON u.id = f.owner_user_id
     LEFT JOIN file_groups g ON g.id = f.group_id
     ${where}
     ORDER BY f.created_at DESC LIMIT ?`
  ).all(...values) as AdminFileRecord[];
}

export function getAdminFileOverviewPage(query?: string, page = 1, limit = 20): AdminPagination<AdminFileRecord> {
  const text = query?.trim().toLowerCase();
  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 100);
  const where = text ? "WHERE lower(f.original_name) LIKE ? OR lower(COALESCE(u.email, '')) LIKE ?" : "";
  const searchValues = text ? [`%${text}%`, `%${text}%`] : [];
  const total = (db.prepare(
    `SELECT COUNT(*) AS count
     FROM files f
     LEFT JOIN users u ON u.id = f.owner_user_id
     ${where}`
  ).get(...searchValues) as { count: number }).count;
  const files = db.prepare(
    `SELECT f.token, f.original_name, f.size, f.mime_type, u.email AS owner_email,
            g.token AS group_token, f.expires_at, f.download_count, f.max_downloads,
            f.revoked_at, f.content_encryption, f.created_at
     FROM files f
     LEFT JOIN users u ON u.id = f.owner_user_id
     LEFT JOIN file_groups g ON g.id = f.group_id
     ${where}
     ORDER BY f.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...searchValues, safeLimit, (safePage - 1) * safeLimit) as AdminFileRecord[];

  return {
    items: files,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

export function createAdminAuditEvent(data: { adminUserId: number; action: string; targetType: string; targetId?: string | null; metadata?: unknown }): void {
  db.prepare(
    `INSERT INTO admin_audit_events (admin_user_id, action, target_type, target_id, metadata)
     VALUES (?, ?, ?, ?, ?)`
  ).run(data.adminUserId, data.action, data.targetType, data.targetId ?? null, data.metadata === undefined ? null : JSON.stringify(data.metadata));
}

export function getAdminAuditEvents(limit = 100): AdminAuditEventRecord[] {
  return db.prepare(
    `SELECT a.*, u.email AS admin_email
     FROM admin_audit_events a JOIN users u ON u.id = a.admin_user_id
     ORDER BY a.id DESC LIMIT ?`
  ).all(Math.min(Math.max(limit, 1), 500)) as AdminAuditEventRecord[];
}

export function updateUserAdminSettings(
  id: number,
  data: Partial<Pick<AdminUserRecord, "role" | "blocked_at" | "max_file_size" | "storage_limit" | "active_link_limit" | "max_downloads" | "max_parallel_uploads">>
): boolean {
  const updates: string[] = [];
  const values: Array<string | number | null> = [];
  for (const field of ["role", "blocked_at", "max_file_size", "storage_limit", "active_link_limit", "max_downloads", "max_parallel_uploads"] as const) {
    if (data[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(data[field] as string | number | null);
    }
  }
  if (!updates.length) return false;
  return db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values, id).changes === 1;
}

export function getUserBySessionHash(tokenHash: string): AuthUserRecord | undefined {
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  return db
    .prepare(
      `SELECT u.id, u.email, u.role, u.blocked_at, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.blocked_at IS NULL`
    )
    .get(tokenHash, now) as AuthUserRecord | undefined;
}

export function getUserBySessionHashIncludingBlocked(tokenHash: string): AuthUserRecord | undefined {
  return db
    .prepare(
      `SELECT u.id, u.email, u.role, u.blocked_at, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(tokenHash, Date.now()) as AuthUserRecord | undefined;
}

export function createUser(email: string, passwordHash: string): UserRecord {
  const create = db.transaction(() => {
    const userCount = (db.prepare("SELECT COUNT(*) as count FROM users").get() as {
      count: number;
    }).count;
    const role: UserRole = userCount === 0 ? "admin" : "user";
    const result = db
      .prepare(
        "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)"
      )
      .run(email, passwordHash, role);
    return getUserById(result.lastInsertRowid as number)!;
  });

  return create();
}

export function updateUserPassword(userId: number, passwordHash: string): void {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

export function createSession(
  tokenHash: string,
  userId: number,
  expiresAt: number
): void {
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).run(tokenHash, userId, expiresAt, now);
}

export function deleteSession(tokenHash: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function deleteUserSessions(userId: number): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function createPasswordResetToken(
  tokenHash: string,
  userId: number,
  expiresAt: number
): void {
  const now = Date.now();
  db.transaction(() => {
    db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at <= ?")
      .run(userId, now);
    db.prepare(
      "INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).run(tokenHash, userId, expiresAt, now);
  })();
}

export function resetPasswordWithToken(
  tokenHash: string,
  passwordHash: string
): boolean {
  const reset = db.transaction(() => {
    const now = Date.now();
    const token = db
      .prepare(
        `SELECT user_id FROM password_reset_tokens
         WHERE token_hash = ? AND expires_at > ? AND used_at IS NULL`
      )
      .get(tokenHash, now) as { user_id: number } | undefined;
    if (!token) return false;

    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      passwordHash,
      token.user_id
    );
    db.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?").run(
      now,
      tokenHash
    );
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(token.user_id);
    return true;
  });

  return reset();
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

export function createFileGroup(data: {
  token: string;
  ownerUserId?: number | null;
  expiresAt: string | null;
  maxDownloads: number | null;
  passwordHash: string | null;
}): FileGroupRecord {
  const result = db
    .prepare(
      `INSERT INTO file_groups (token, owner_user_id, expires_at, max_downloads, password_hash)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(data.token, data.ownerUserId ?? null, data.expiresAt, data.maxDownloads, data.passwordHash);
  return db
    .prepare("SELECT * FROM file_groups WHERE id = ?")
    .get(result.lastInsertRowid) as FileGroupRecord;
}

export function getFileGroupByToken(token: string): FileGroupRecord | undefined {
  return db
    .prepare("SELECT * FROM file_groups WHERE token = ?")
    .get(token) as FileGroupRecord | undefined;
}

export function getFileGroupById(id: number): FileGroupRecord | undefined {
  return db
    .prepare("SELECT * FROM file_groups WHERE id = ?")
    .get(id) as FileGroupRecord | undefined;
}

export function getFilesByGroupId(groupId: number): FileWithAccount[] {
  return db
    .prepare(
      `SELECT f.*, s.bot_token, s.channel_id, s.name as account_name
       FROM files f
       JOIN storage_accounts s ON f.storage_account_id = s.id
       WHERE f.group_id = ?
       ORDER BY f.id ASC`
    )
    .all(groupId) as FileWithAccount[];
}

export function updateFileGroupPasswordHash(groupToken: string, passwordHash: string): void {
  db
    .prepare("UPDATE file_groups SET password_hash = ? WHERE token = ?")
    .run(passwordHash, groupToken);
}

export function updateFilePasswordHash(token: string, passwordHash: string): void {
  db.prepare("UPDATE files SET password_hash = ? WHERE token = ?").run(passwordHash, token);
}

export function createFileRecord(data: {
  token: string;
  originalName: string;
  mimeType: string;
  size: number;
  contentSize?: number;
  storageAccountId: number;
  telegramFileId: string;
  telegramMessageId: number;
  expiresAt: string | null;
  maxDownloads: number | null;
  passwordHash: string | null;
  storageEncryption?: StorageEncryption;
  storageKeyWrap?: string | null;
  contentEncryption?: ContentEncryption;
  groupId?: number | null;
  ownerUserId?: number | null;
}): FileRecord {
  const create = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO files (
          token, original_name, mime_type, size, content_size, storage_account_id,
          telegram_file_id, telegram_message_id, owner_user_id, expires_at, max_downloads, password_hash,
          storage_encryption, storage_key_wrap, content_encryption, group_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.token,
        data.originalName,
        data.mimeType,
        data.size,
        data.contentSize ?? data.size,
        data.storageAccountId,
        data.telegramFileId,
        data.telegramMessageId,
        data.ownerUserId ?? null,
        data.expiresAt,
        data.maxDownloads,
        data.passwordHash,
        data.storageEncryption ?? "none",
        data.storageKeyWrap ?? null,
        data.contentEncryption ?? "none",
        data.groupId ?? null,
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

export function createShortLink(data: { code: string; targetToken: string; ownerUserId: number | null }): void {
  db.prepare(
    "INSERT INTO short_links (code, target_token, owner_user_id) VALUES (?, ?, ?)"
  ).run(data.code, data.targetToken, data.ownerUserId);
}

export interface ShortLinkRecord {
  code: string;
  target_token: string;
  owner_user_id: number | null;
}

export function getShortLink(code: string): ShortLinkRecord | undefined {
  return db.prepare("SELECT * FROM short_links WHERE code = ?").get(code) as { code: string; target_token: string; owner_user_id: number | null } | undefined;
}

export function getShortLinkByTargetToken(targetToken: string): ShortLinkRecord | undefined {
  return db.prepare("SELECT * FROM short_links WHERE target_token = ?").get(targetToken) as ShortLinkRecord | undefined;
}

export function deleteShortLink(targetToken: string): void {
  db.prepare("DELETE FROM short_links WHERE target_token = ?").run(targetToken);
}

function transferCte(): string {
  return `
    WITH transfers AS (
      SELECT
        'group' AS kind,
        g.token AS token,
        g.owner_user_id AS owner_user_id,
        'Пакет из ' || COUNT(f.id) || ' файлов' AS name,
        COALESCE(SUM(f.size), 0) AS size,
        COUNT(f.id) AS file_count,
        g.expires_at AS expires_at,
        g.download_count AS download_count,
        g.max_downloads AS max_downloads,
        CASE WHEN g.password_hash IS NULL THEN 0 ELSE 1 END AS has_password,
        CASE WHEN SUM(CASE WHEN f.storage_encryption = 'server-v1' THEN 1 ELSE 0 END) = COUNT(f.id) THEN 1 ELSE 0 END AS storage_encrypted,
        CASE WHEN SUM(CASE WHEN f.content_encryption = 'e2ee-v1' THEN 1 ELSE 0 END) = COUNT(f.id) THEN 'e2ee-v1' ELSE 'none' END AS content_encryption,
        g.created_at AS created_at,
        g.revoked_at AS revoked_at
      FROM file_groups g
      JOIN files f ON f.group_id = g.id
      GROUP BY g.id
      UNION ALL
      SELECT
        'file' AS kind,
        f.token AS token,
        f.owner_user_id AS owner_user_id,
        f.original_name AS name,
        f.size AS size,
        1 AS file_count,
        f.expires_at AS expires_at,
        f.download_count AS download_count,
        f.max_downloads AS max_downloads,
        CASE WHEN f.password_hash IS NULL THEN 0 ELSE 1 END AS has_password,
        CASE WHEN f.storage_encryption = 'server-v1' THEN 1 ELSE 0 END AS storage_encrypted,
        f.content_encryption AS content_encryption,
        f.created_at AS created_at,
        f.revoked_at AS revoked_at
      FROM files f
      WHERE f.group_id IS NULL
    )
  `;
}

export function getOwnedTransfers(
  userId: number,
  options: {
    query?: string;
    status?: "active" | "expired" | "revoked" | "password" | "e2ee";
    kind?: "file" | "group";
    sort?: "created" | "size" | "downloads";
    page?: number;
    pageSize?: number;
  } = {}
): { items: OwnedTransferRecord[]; total: number } {
  const conditions = ["owner_user_id = ?"];
  const parameters: Array<string | number> = [userId];
  if (options.query?.trim()) {
    conditions.push("lower(name) LIKE ?");
    parameters.push(`%${options.query.trim().toLowerCase()}%`);
  }
  if (options.kind) {
    conditions.push("kind = ?");
    parameters.push(options.kind);
  }
  if (options.status === "revoked") conditions.push("revoked_at IS NOT NULL");
  if (options.status === "expired") {
    conditions.push("revoked_at IS NULL AND expires_at IS NOT NULL AND julianday(expires_at) <= julianday('now')");
  }
  if (options.status === "active") {
    conditions.push("revoked_at IS NULL AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))");
  }
  if (options.status === "password") conditions.push("has_password = 1");
  if (options.status === "e2ee") conditions.push("content_encryption = 'e2ee-v1'");

  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
  const page = Math.max(options.page ?? 1, 1);
  const where = conditions.join(" AND ");
  const sort = options.sort === "size"
    ? "size DESC, created_at DESC"
    : options.sort === "downloads"
      ? "download_count DESC, created_at DESC"
      : "created_at DESC";
  const total = (db.prepare(`${transferCte()} SELECT COUNT(*) AS count FROM transfers WHERE ${where}`)
    .get(...parameters) as { count: number }).count;
  const items = db.prepare(
    `${transferCte()} SELECT * FROM transfers WHERE ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`
  ).all(...parameters, pageSize, (page - 1) * pageSize) as OwnedTransferRecord[];
  return { items, total };
}

export function getOwnedTransferDetails(userId: number, token: string): OwnedTransferDetails | undefined {
  const group = getFileGroupByToken(token);
  if (group) {
    if (group.owner_user_id !== userId) return undefined;
    return { kind: "group", token, group, file: null, files: getFilesByGroupId(group.id) };
  }
  const file = getFileByToken(token);
  if (!file || file.owner_user_id !== userId || file.group_id !== null) return undefined;
  return { kind: "file", token, group: null, file, files: [file] };
}

export function updateOwnedTransfer(
  userId: number,
  token: string,
  data: {
    expiresAt?: string | null;
    maxDownloads?: number | null;
    passwordHash?: string | null;
  }
): boolean {
  const details = getOwnedTransferDetails(userId, token);
  if (!details) return false;
  db.transaction(() => {
    if (details.kind === "group") {
      const updates: string[] = [];
      const values: Array<string | number | null> = [];
      if (data.expiresAt !== undefined) { updates.push("expires_at = ?"); values.push(data.expiresAt); }
      if (data.maxDownloads !== undefined) { updates.push("max_downloads = ?"); values.push(data.maxDownloads); }
      if (data.passwordHash !== undefined) { updates.push("password_hash = ?"); values.push(data.passwordHash); }
      if (updates.length) {
        db.prepare(`UPDATE file_groups SET ${updates.join(", ")} WHERE id = ?`).run(...values, details.group!.id);
        const childUpdates: string[] = [];
        const childValues: Array<string | number | null> = [];
        if (data.expiresAt !== undefined) { childUpdates.push("expires_at = ?"); childValues.push(data.expiresAt); }
        if (data.maxDownloads !== undefined) { childUpdates.push("max_downloads = ?"); childValues.push(data.maxDownloads); }
        if (data.passwordHash !== undefined) { childUpdates.push("password_hash = ?"); childValues.push(data.passwordHash); }
        if (childUpdates.length) db.prepare(`UPDATE files SET ${childUpdates.join(", ")} WHERE group_id = ?`).run(...childValues, details.group!.id);
      }
    } else {
      const updates: string[] = [];
      const values: Array<string | number | null> = [];
      if (data.expiresAt !== undefined) { updates.push("expires_at = ?"); values.push(data.expiresAt); }
      if (data.maxDownloads !== undefined) { updates.push("max_downloads = ?"); values.push(data.maxDownloads); }
      if (data.passwordHash !== undefined) { updates.push("password_hash = ?"); values.push(data.passwordHash); }
      if (updates.length) db.prepare(`UPDATE files SET ${updates.join(", ")} WHERE id = ?`).run(...values, details.file!.id);
    }
  })();
  return true;
}

export function setOwnedTransferRevoked(userId: number, token: string, revoked: boolean): boolean {
  const details = getOwnedTransferDetails(userId, token);
  if (!details) return false;
  const value = revoked ? new Date().toISOString() : null;
  if (details.kind === "group") {
    db.transaction(() => {
      db.prepare("UPDATE file_groups SET revoked_at = ? WHERE id = ?").run(value, details.group!.id);
      db.prepare("UPDATE files SET revoked_at = ? WHERE group_id = ?").run(value, details.group!.id);
    })();
  } else {
    db.prepare("UPDATE files SET revoked_at = ? WHERE id = ?").run(value, details.file!.id);
  }
  return true;
}

export function deleteOwnedTransferRecords(userId: number, token: string): FileWithAccount[] | undefined {
  const details = getOwnedTransferDetails(userId, token);
  if (!details) return undefined;
  db.transaction(() => {
    if (details.kind === "group") {
      db.prepare("DELETE FROM files WHERE group_id = ?").run(details.group!.id);
      db.prepare("DELETE FROM file_groups WHERE id = ?").run(details.group!.id);
      for (const file of details.files) {
        db.prepare("UPDATE storage_accounts SET files_count = MAX(files_count - 1, 0) WHERE id = ?").run(file.storage_account_id);
      }
    } else {
      db.prepare("DELETE FROM files WHERE id = ?").run(details.file!.id);
      db.prepare("UPDATE storage_accounts SET files_count = MAX(files_count - 1, 0) WHERE id = ?").run(details.file!.storage_account_id);
    }
  })();
  return details.files;
}

export function createDownloadEvent(data: {
  fileId: number;
  groupId: number | null;
  outcome: DownloadEventOutcome;
  ipHash: string | null;
  userAgent: string | null;
  isGroupDownload: boolean;
}): void {
  db.prepare(
    `INSERT INTO download_events (file_id, group_id, outcome, ip_hash, user_agent, is_group_download)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(data.fileId, data.groupId, data.outcome, data.ipHash, data.userAgent, data.isGroupDownload ? 1 : 0);
}

export function getUserDownloadStats(userId: number, limit = 20): {
  total: number;
  recent: Array<{ file_name: string; token: string; outcome: string; created_at: string; is_group_download: number }>;
} {
  const total = (db.prepare(
    `SELECT COUNT(*) AS count FROM download_events e
     JOIN files f ON f.id = e.file_id
     WHERE f.owner_user_id = ?`
  ).get(userId) as { count: number }).count;
  const recent = db.prepare(
    `SELECT f.original_name AS file_name, f.token, e.outcome, e.created_at, e.is_group_download
     FROM download_events e
     JOIN files f ON f.id = e.file_id
     WHERE f.owner_user_id = ?
     ORDER BY e.created_at DESC LIMIT ?`
  ).all(userId, Math.min(Math.max(limit, 1), 100)) as Array<{ file_name: string; token: string; outcome: string; created_at: string; is_group_download: number }>;
  return { total, recent };
}

export function getUserNotificationSettings(userId: number): UserNotificationSettings {
  db.prepare("INSERT OR IGNORE INTO user_notification_settings (user_id) VALUES (?)").run(userId);
  return db.prepare("SELECT * FROM user_notification_settings WHERE user_id = ?")
    .get(userId) as UserNotificationSettings;
}

export function updateUserNotificationSettings(
  userId: number,
  data: Partial<Omit<UserNotificationSettings, "user_id">>
): UserNotificationSettings {
  const current = getUserNotificationSettings(userId);
  const next = {
    email_enabled: data.email_enabled ?? current.email_enabled,
    download_notifications: data.download_notifications ?? current.download_notifications,
    summary_notifications: data.summary_notifications ?? current.summary_notifications,
    expiry_warning_days: data.expiry_warning_days ?? current.expiry_warning_days,
  };
  db.prepare(
    `UPDATE user_notification_settings
     SET email_enabled = ?, download_notifications = ?, summary_notifications = ?, expiry_warning_days = ?
     WHERE user_id = ?`
  ).run(next.email_enabled, next.download_notifications, next.summary_notifications, next.expiry_warning_days, userId);
  return { user_id: userId, ...next };
}

export function enqueueNotification(data: {
  userId: number;
  kind: string;
  payload: string;
  dedupeKey?: string | null;
  availableAt?: number;
}): boolean {
  return db.prepare(
    `INSERT OR IGNORE INTO notification_outbox
     (user_id, kind, payload, dedupe_key, available_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    data.userId,
    data.kind,
    data.payload,
    data.dedupeKey ?? null,
    data.availableAt ?? Date.now(),
    Date.now()
  ).changes === 1;
}

export function getPendingNotifications(limit = 20): PendingNotification[] {
  return db.prepare(
    `SELECT n.*, u.email
     FROM notification_outbox n
     JOIN users u ON u.id = n.user_id
     WHERE n.sent_at IS NULL AND n.available_at <= ?
     ORDER BY n.id ASC LIMIT ?`
  ).all(Date.now(), Math.min(Math.max(limit, 1), 100)) as PendingNotification[];
}

export function markNotificationSent(id: number): void {
  db.prepare("UPDATE notification_outbox SET sent_at = ? WHERE id = ?").run(Date.now(), id);
}

export function markNotificationFailed(id: number, error: string): void {
  db.prepare(
    `UPDATE notification_outbox
     SET attempts = attempts + 1,
         last_error = ?,
         available_at = ?
     WHERE id = ?`
  ).run(error.slice(0, 1000), Date.now() + 5 * 60 * 1000, id);
}

export function createUploadSession(data: Omit<UploadSessionRecord, "created_at" | "updated_at" | "completed_at" | "result_json" | "status" | "pin_hash" | "one_time" | "max_recipients"> & { status?: UploadSessionRecord["status"] }): UploadSessionRecord {
  const now = Date.now();
  db.prepare(
    `INSERT INTO upload_sessions
     (id, owner_user_id, anonymous_token, file_name, mime_type, total_size, chunk_size, total_chunks,
     checksum, content_encryption, original_size, expiry, expires_at, max_downloads, password_hash,
      group_token, status, upload_root, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.id, data.owner_user_id, data.anonymous_token, data.file_name, data.mime_type,
    data.total_size, data.chunk_size, data.total_chunks, data.checksum, data.content_encryption,
    data.original_size, data.expiry, data.expires_at, data.max_downloads, data.password_hash,
    data.group_token, data.status ?? "active", data.upload_root, now, now
  );
  return getUploadSession(data.id)!;
}

export function getUploadSession(id: string): UploadSessionRecord | undefined {
  return db.prepare("SELECT * FROM upload_sessions WHERE id = ?").get(id) as UploadSessionRecord | undefined;
}

export function getUploadSessionParts(sessionId: string): UploadSessionPartRecord[] {
  return db.prepare(
    "SELECT * FROM upload_session_parts WHERE session_id = ? ORDER BY part_index ASC"
  ).all(sessionId) as UploadSessionPartRecord[];
}

export function getUploadSessionPart(sessionId: string, partIndex: number): UploadSessionPartRecord | undefined {
  return db.prepare(
    "SELECT * FROM upload_session_parts WHERE session_id = ? AND part_index = ?"
  ).get(sessionId, partIndex) as UploadSessionPartRecord | undefined;
}

export function upsertUploadSessionPart(data: UploadSessionPartRecord): void {
  db.prepare(
    `INSERT INTO upload_session_parts (session_id, part_index, size, checksum, path, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, part_index) DO UPDATE SET
       size = excluded.size, checksum = excluded.checksum, path = excluded.path, created_at = excluded.created_at`
  ).run(data.session_id, data.part_index, data.size, data.checksum, data.path, data.created_at);
  db.prepare("UPDATE upload_sessions SET updated_at = ? WHERE id = ?").run(Date.now(), data.session_id);
}

export function setUploadSessionStatus(
  id: string,
  status: UploadSessionRecord["status"]
): void {
  db.prepare(
    "UPDATE upload_sessions SET status = ?, updated_at = ?, completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END WHERE id = ?"
  ).run(status, Date.now(), status, Date.now(), id);
}

export function setUploadSessionResult(id: string, result: unknown): void {
  db.prepare(
    "UPDATE upload_sessions SET status = 'completed', result_json = ?, updated_at = ?, completed_at = ? WHERE id = ?"
  ).run(JSON.stringify(result), Date.now(), Date.now(), id);
}

export function deleteUploadSession(id: string): void {
  db.prepare("DELETE FROM upload_sessions WHERE id = ?").run(id);
}

export function getStaleUploadSessions(before: number, limit = 100): UploadSessionRecord[] {
  return db.prepare(
    `SELECT * FROM upload_sessions
     WHERE status IN ('active', 'assembling', 'failed', 'completed') AND updated_at < ?
     ORDER BY updated_at ASC LIMIT ?`
  ).all(before, Math.min(Math.max(limit, 1), 500)) as UploadSessionRecord[];
}

export function getActiveUploadSessionCount(userId: number): number {
  return (db.prepare(
    "SELECT COUNT(*) AS count FROM upload_sessions WHERE owner_user_id = ? AND status IN ('active', 'assembling')"
  ).get(userId) as { count: number }).count;
}

export function reserveGroupDownload(token: string): boolean {
  return db.prepare(
    `UPDATE file_groups
     SET download_count = download_count + 1
     WHERE token = ?
       AND revoked_at IS NULL
       AND (max_downloads IS NULL OR download_count < max_downloads)`
  ).run(token).changes === 1;
}

export function releaseGroupDownload(token: string): void {
  db
    .prepare(
      "UPDATE file_groups SET download_count = MAX(download_count - 1, 0) WHERE token = ?"
    )
    .run(token);
}

/** Atomically reserves one download slot. Call releaseDownloadReservation on upstream failure. */
export function reserveDownload(token: string): boolean {
  return db.prepare(
    `UPDATE files
     SET download_count = download_count + 1
     WHERE token = ?
       AND revoked_at IS NULL
       AND (max_downloads IS NULL OR download_count < max_downloads)`
  ).run(token).changes === 1;
}

export function releaseDownloadReservation(token: string): void {
  db.prepare(
    "UPDATE files SET download_count = MAX(download_count - 1, 0) WHERE token = ?"
  ).run(token);
}

export function consumeAccessAttempt(rateKey: string, maxAttempts = 10, windowMs = 15 * 60 * 1000): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  return db.transaction(() => {
    const current = db.prepare("SELECT * FROM access_rate_limits WHERE rate_key = ?").get(rateKey) as {
      rate_key: string;
      window_started_at: number;
      attempts: number;
      blocked_until: number | null;
    } | undefined;
    if (current?.blocked_until && current.blocked_until > now) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.blocked_until - now) / 1000)) };
    }
    const sameWindow = current && now - current.window_started_at < windowMs;
    const attempts = sameWindow ? current.attempts + 1 : 1;
    const blockedUntil = attempts > maxAttempts ? now + windowMs : null;
    db.prepare(
      `INSERT INTO access_rate_limits (rate_key, window_started_at, attempts, blocked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(rate_key) DO UPDATE SET
         window_started_at = excluded.window_started_at,
         attempts = excluded.attempts,
         blocked_until = excluded.blocked_until`
    ).run(rateKey, sameWindow ? current.window_started_at : now, attempts, blockedUntil);
    return blockedUntil ? { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) } : { allowed: true, retryAfterSeconds: 0 };
  })();
}

export function clearAccessAttempts(rateKey: string): void {
  db.prepare("DELETE FROM access_rate_limits WHERE rate_key = ?").run(rateKey);
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
      .prepare("SELECT storage_account_id, group_id FROM files WHERE token = ?")
      .get(token) as { storage_account_id: number; group_id: number | null } | undefined;
    if (!file) return;

    db.prepare("DELETE FROM files WHERE token = ?").run(token);
    db.prepare(
      "UPDATE storage_accounts SET files_count = MAX(files_count - 1, 0) WHERE id = ?"
    ).run(file.storage_account_id);

    if (file.group_id !== null) {
      const remaining = db
        .prepare("SELECT 1 FROM files WHERE group_id = ? LIMIT 1")
        .get(file.group_id);
      if (!remaining) db.prepare("DELETE FROM file_groups WHERE id = ?").run(file.group_id);
    }
  })();
}

export function getFilesNearExpiry(limit = 500): FileWithAccount[] {
  return db.prepare(
    `SELECT f.*, s.bot_token, s.channel_id, s.name as account_name
     FROM files f
     JOIN storage_accounts s ON f.storage_account_id = s.id
     WHERE f.owner_user_id IS NOT NULL
       AND f.expires_at IS NOT NULL
       AND julianday(f.expires_at) > julianday('now')
       AND julianday(f.expires_at) <= julianday('now', '+30 days')
     ORDER BY f.expires_at ASC LIMIT ?`
  ).all(limit) as FileWithAccount[];
}

export function markFileDeletionFailed(token: string, error: string): void {
  db.prepare(
    `UPDATE files
     SET deletion_attempts = deletion_attempts + 1,
         last_deletion_error = ?
     WHERE token = ?`
  ).run(error.slice(0, 1000), token);
}

export function markFileTelegramDeleted(token: string): void {
  db.prepare("UPDATE files SET telegram_deleted_at = ?, last_deletion_error = NULL WHERE token = ?")
    .run(new Date().toISOString(), token);
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
