"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatFileSize } from "@/lib/utils";

interface StorageAccount {
  id: number;
  name: string;
  channelId: string;
  isActive: boolean;
  filesCount: number;
  createdAt: string;
  botToken: string;
}

interface Stats {
  totalFiles: number;
  totalSize: number;
  activeAccounts: number;
  expiredFiles: number;
}

interface CurrentUser {
  email: string;
  role: "user" | "admin";
}

interface AdminUser {
  id: number;
  email: string;
  role: "user" | "admin";
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

interface AdminFile {
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
  content_encryption: "none" | "e2ee-v1";
  created_at: string;
}

interface AdminAudit {
  id: number;
  admin_email: string;
  action: string;
  target_type: string;
  target_id: string | null;
  created_at: string;
}

export default function AdminPage() {
  const [accounts, setAccounts] = useState<StorageAccount[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [legacyFiles, setLegacyFiles] = useState<number | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [adminFiles, setAdminFiles] = useState<AdminFile[]>([]);
  const [auditEvents, setAuditEvents] = useState<AdminAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    botToken: "",
    channelId: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [migratingEncryption, setMigratingEncryption] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [authState, setAuthState] = useState<
    "loading" | "allowed" | "unauthenticated" | "forbidden"
  >("loading");
  const [skipConnectionTest, setSkipConnectionTest] = useState(false);

  const getHeaders = useCallback(() => {
    return {
      "Content-Type": "application/json",
    };
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const meResponse = await fetch("/api/auth/me");
      const meData = (await meResponse.json()) as { user: CurrentUser | null };
      if (!meData.user) {
        setAuthState("unauthenticated");
        setLoading(false);
        return;
      }
      if (meData.user.role !== "admin") {
        setAuthState("forbidden");
        setLoading(false);
        return;
      }

      setAuthState("allowed");
      const res = await fetch("/api/admin/accounts", {
        headers: getHeaders(),
      });

      if (res.status === 401) {
        setAuthState("unauthenticated");
        setLoading(false);
        return;
      }
      if (res.status === 403) {
        setAuthState("forbidden");
        setLoading(false);
        return;
      }

      if (!res.ok) {
        throw new Error(`Ошибка сервера (${res.status})`);
      }

      const data = await res.json();
      setAccounts(data.accounts);
      setStats(data.stats);

      const usersResponse = await fetch("/api/admin/users");
      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        setUsers(usersData.users);
      }

      const filesResponse = await fetch("/api/admin/files?limit=100");
      if (filesResponse.ok) {
        const filesData = await filesResponse.json();
        setAdminFiles(filesData.files);
      }
      const auditResponse = await fetch("/api/admin/audit?limit=50");
      if (auditResponse.ok) setAuditEvents((await auditResponse.json()).events);

      const encryptionResponse = await fetch("/api/admin/encryption");
      if (encryptionResponse.ok) {
        const encryptionData = (await encryptionResponse.json()) as { legacyFiles: number };
        setLegacyFiles(encryptionData.legacyFiles);
      }
    } catch (err) {
      const msg =
        err instanceof TypeError
          ? "Сервер недоступен. Убедитесь, что npm run dev запущен."
          : err instanceof Error
            ? err.message
            : "Ошибка загрузки данных";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [getHeaders]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          ...formData,
          testConnection: !skipConnectionTest,
        }),
      });

      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        throw new Error(`Сервер вернул некорректный ответ (${res.status})`);
      }

      if (!res.ok) {
        throw new Error(data.error || `Ошибка (${res.status})`);
      }

      setSuccess("Аккаунт успешно добавлен!");
      setFormData({ name: "", botToken: "", channelId: "" });
      setShowForm(false);
      fetchData();
    } catch (err) {
      const msg =
        err instanceof TypeError
          ? "Не удалось связаться с сервером. Проверьте, что npm run dev запущен и вы на правильном порту (localhost:3000)."
          : err instanceof Error
            ? err.message
            : "Ошибка";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleAccount = async (id: number, isActive: boolean) => {
    await fetch("/api/admin/accounts", {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ id, isActive: !isActive }),
    });
    fetchData();
  };

  const deleteAccount = async (account: StorageAccount) => {
    if (account.filesCount > 0) {
      setError(
        "Нельзя удалить аккаунт с файлами. Отключите его — существующие ссылки продолжат работать до очистки."
      );
      return;
    }
    if (!confirm("Удалить этот пустой аккаунт?")) return;

    const res = await fetch(`/api/admin/accounts?id=${account.id}`, {
      method: "DELETE",
      headers: getHeaders(),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Не удалось удалить аккаунт");
      return;
    }
    fetchData();
  };

  const encryptLegacyFiles = async () => {
    if (!legacyFiles || migratingEncryption) return;
    if (!confirm(`Зашифровать старые файлы партиями? Обработать до 5 файлов сейчас.`)) return;

    setMigratingEncryption(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/encryption", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ limit: 5 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Не удалось зашифровать старые файлы");

      setLegacyFiles(data.legacyFiles ?? 0);
      setSuccess(`Зашифровано файлов: ${data.migrated}. Осталось: ${data.legacyFiles ?? 0}.`);
      if (data.warnings?.length) setError(data.warnings.join("\n"));
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка миграции шифрования");
    } finally {
      setMigratingEncryption(false);
    }
  };

  const updateUser = async (user: AdminUser, data: Record<string, unknown>) => {
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ id: user.id, ...data }),
    });
    const response = await res.json().catch(() => ({}));
    if (!res.ok) setError(response.error || "Не удалось изменить пользователя");
    else {
      setSuccess("Настройки пользователя обновлены");
      fetchData();
    }
  };

  if (authState === "unauthenticated") {
    return (
      <div className="max-w-md mx-auto px-4 py-32 animate-fade-in">
        <div className="glass rounded-2xl p-8 gradient-border">
          <h1 className="text-2xl font-bold mb-4 text-center">Админ-панель</h1>
          <p className="text-gray-400 text-sm mb-6 text-center">
            Для доступа к панели войдите в аккаунт администратора.
          </p>
          <Link
            href="/login?next=/admin"
            className="block text-center w-full py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium hover:opacity-90 transition-opacity"
          >
            Войти
          </Link>
        </div>
      </div>
    );
  }

  if (authState === "forbidden") {
    return (
      <div className="max-w-md mx-auto px-4 py-32 animate-fade-in">
        <div className="glass rounded-2xl p-8 text-center gradient-border">
          <h1 className="text-2xl font-bold mb-4">Недостаточно прав</h1>
          <p className="text-gray-400 text-sm">
            Админ-панель доступна только пользователям с ролью администратора.
          </p>
        </div>
      </div>
    );
  }

  if (authState === "loading" || loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-32 text-center">
        <div className="w-12 h-12 mx-auto border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 animate-fade-in">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">
            Админ<span className="gradient-text">-панель</span>
          </h1>
          <p className="text-gray-400 mt-1">
            Управление Telegram-аккаунтами для хранения
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-5 py-2.5 rounded-xl bg-accent/20 text-accent-light font-medium hover:bg-accent/30 transition-colors"
        >
          {showForm ? "Отмена" : "+ Добавить бота"}
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Файлов", value: stats.totalFiles },
            { label: "Общий размер", value: formatFileSize(stats.totalSize) },
            { label: "Активных ботов", value: stats.activeAccounts },
            { label: "Истекло", value: stats.expiredFiles },
          ].map((stat) => (
            <div key={stat.label} className="glass rounded-xl p-4 text-center">
              <p className="text-2xl font-bold gradient-text">{stat.value}</p>
              <p className="text-sm text-gray-400 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {legacyFiles !== null && (
        <div className="glass rounded-2xl p-5 mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="font-medium">Шифрование хранилища</p>
            <p className="text-sm text-gray-400 mt-1">
              {legacyFiles === 0
                ? "Все файлы хранятся в зашифрованном виде."
                : `Старых незашифрованных файлов: ${legacyFiles}.`}
            </p>
          </div>
          <button
            onClick={encryptLegacyFiles}
            disabled={legacyFiles === 0 || migratingEncryption}
            className="px-4 py-2.5 rounded-xl bg-accent/20 text-accent-light text-sm font-medium hover:bg-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {migratingEncryption ? "Шифрование..." : "Зашифровать старые файлы"}
          </button>
        </div>
      )}

      {users.length > 0 && (
        <div className="glass rounded-2xl p-5 mb-8">
          <h3 className="font-medium mb-4">Пользователи и лимиты</h3>
          <div className="space-y-4">
            {users.map((user) => (
              <div key={user.id} className="rounded-xl border border-white/10 p-4">
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{user.email}</p>
                    <p className="text-xs text-gray-500 mt-1">{user.files_count} файлов · {formatFileSize(user.storage_used)} · {user.blocked_at ? "заблокирован" : "активен"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select value={user.role} onChange={(event) => updateUser(user, { role: event.target.value })} className="bg-surface-overlay border border-white/10 rounded-lg px-2.5 py-2 text-sm">
                      <option value="user">Пользователь</option><option value="admin">Администратор</option>
                    </select>
                    <button type="button" onClick={() => updateUser(user, { blocked: !user.blocked_at })} className="px-3 py-2 rounded-lg text-sm bg-white/5 hover:bg-white/10">{user.blocked_at ? "Разблокировать" : "Заблокировать"}</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
                  {([
                    ["maxFileSize", "Файл", user.max_file_size],
                    ["storageLimit", "Хранилище", user.storage_limit],
                    ["activeLinkLimit", "Ссылки", user.active_link_limit],
                    ["maxDownloads", "Скачивания", user.max_downloads],
                    ["maxParallelUploads", "Параллельно", user.max_parallel_uploads],
                  ] as const).map(([field, label, value]) => (
                    <label key={field} className="text-xs text-gray-500">{label}<input defaultValue={value ?? ""} placeholder="∞" type="number" min="1" onBlur={(event) => { const next = event.target.value; if (String(value ?? "") !== next) updateUser(user, { [field]: next || null }); }} className="mt-1 w-full bg-surface-overlay border border-white/10 rounded-lg px-2.5 py-2 text-sm text-gray-300" /></label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {adminFiles.length > 0 && (
        <div className="glass rounded-2xl p-5 mb-8">
          <h3 className="font-medium mb-4">Обзор всех файлов</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500"><tr><th className="pb-3 pr-4">Файл</th><th className="pb-3 pr-4">Владелец</th><th className="pb-3 pr-4">Размер</th><th className="pb-3 pr-4">Скачивания</th><th className="pb-3">Статус</th></tr></thead>
              <tbody>{adminFiles.map((file) => <tr key={file.token} className="border-t border-white/5"><td className="py-3 pr-4 max-w-[260px] truncate" title={file.original_name}>{file.original_name}{file.content_encryption === "e2ee-v1" && <span className="ml-2 text-xs text-accent-light">E2EE</span>}</td><td className="py-3 pr-4 text-gray-400">{file.owner_email || "Гость"}</td><td className="py-3 pr-4 text-gray-400">{formatFileSize(file.size)}</td><td className="py-3 pr-4 text-gray-400">{file.download_count}{file.max_downloads ? ` / ${file.max_downloads}` : ""}</td><td className="py-3 text-gray-400">{file.revoked_at ? "Отозван" : "Активен"}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}

      {auditEvents.length > 0 && (
        <div className="glass rounded-2xl p-5 mb-8">
          <h3 className="font-medium mb-4">Журнал действий администраторов</h3>
          <div className="space-y-2 text-sm">{auditEvents.map((event) => <div key={event.id} className="flex flex-wrap gap-x-3 gap-y-1 border-b border-white/5 pb-2 text-gray-400"><span className="text-gray-300">{event.admin_email}</span><span>{event.action}</span><span>{event.target_type}{event.target_id ? ` #${event.target_id}` : ""}</span><span className="text-gray-600">{event.created_at}</span></div>)}</div>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="glass rounded-2xl p-6 mb-8 space-y-4 animate-slide-up"
        >
          <h3 className="font-medium">Новый Telegram-бот</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Название</label>
              <input
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="Основной бот"
                required
                className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">
                ID канала
              </label>
              <input
                value={formData.channelId}
                onChange={(e) =>
                  setFormData({ ...formData, channelId: e.target.value })
                }
                placeholder="-1001234567890"
                required
                className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              Токен бота
            </label>
            <input
              value={formData.botToken}
              onChange={(e) =>
                setFormData({ ...formData, botToken: e.target.value })
              }
              placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              required
              className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50 font-mono"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={skipConnectionTest}
              onChange={(e) => setSkipConnectionTest(e.target.checked)}
              className="rounded border-white/20"
            />
            Пропустить проверку подключения к Telegram
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? "Проверка и добавление..." : "Добавить"}
          </button>
        </form>
      )}

      {error && (
        <div className="glass rounded-xl p-4 border border-red-500/30 bg-red-500/10 mb-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {success && (
        <div className="glass rounded-xl p-4 border border-green-500/30 bg-green-500/10 mb-4">
          <p className="text-green-400 text-sm">{success}</p>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <div className="text-5xl mb-4">🤖</div>
          <h3 className="text-xl font-medium mb-2">Нет аккаунтов</h3>
          <p className="text-gray-400 text-sm mb-6">
            Добавьте Telegram-бота для начала работы
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="px-6 py-2.5 rounded-xl bg-accent/20 text-accent-light font-medium hover:bg-accent/30 transition-colors"
          >
            Добавить первого бота
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="glass rounded-xl p-5 flex items-center gap-4 glass-hover"
            >
              <div
                className={`w-3 h-3 rounded-full flex-shrink-0 ${
                  account.isActive ? "bg-green-400" : "bg-gray-600"
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium">{account.name}</p>
                <p className="text-sm text-gray-400">
                  {account.botToken} · Канал: {account.channelId} ·{" "}
                  {account.filesCount} файлов
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => toggleAccount(account.id, account.isActive)}
                  className="px-3 py-1.5 rounded-lg text-sm bg-white/5 hover:bg-white/10 transition-colors"
                >
                  {account.isActive ? "Выключить" : "Включить"}
                </button>
                <button
                  onClick={() => deleteAccount(account)}
                  disabled={account.filesCount > 0}
                  title={
                    account.filesCount > 0
                      ? "Сначала дождитесь очистки файлов или отключите аккаунт"
                      : undefined
                  }
                  className="px-3 py-1.5 rounded-lg text-sm text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-12 glass rounded-2xl p-6">
        <h3 className="font-medium mb-4">Как настроить Telegram-бота</h3>
        <ol className="space-y-3 text-sm text-gray-400 list-decimal list-inside">
          <li>
            Создайте бота через{" "}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-light hover:underline"
            >
              @BotFather
            </a>{" "}
            и получите токен
          </li>
          <li>
            Создайте приватный канал в Telegram для хранения файлов
          </li>
          <li>
            Добавьте бота в канал как администратора с правом публикации
          </li>
          <li>
            Узнайте ID канала (начинается с -100...) через{" "}
            <a
              href="https://t.me/userinfobot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-light hover:underline"
            >
              @userinfobot
            </a>{" "}
            или перешлите сообщение из канала в{" "}
            <a
              href="https://t.me/RawDataBot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-light hover:underline"
            >
              @RawDataBot
            </a>
          </li>
          <li>Добавьте бота и канал в форму выше</li>
        </ol>
      </div>
    </div>
  );
}
