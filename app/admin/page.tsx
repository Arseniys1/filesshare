"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatFileSize } from "@/lib/utils";
import ThemedSelect from "@/components/ThemedSelect";

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
  group_revoked_at: string | null;
  expires_at: string | null;
  download_count: number;
  max_downloads: number | null;
  revoked_at: string | null;
  content_encryption: "none" | "e2ee-v1";
  telegram_deleted_at: string | null;
  deletion_attempts: number;
  last_deletion_error: string | null;
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

interface PaginationState {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const ADMIN_PAGE_SIZE = 20;

function Pagination({
  pagination,
  onPageChange,
}: {
  pagination: PaginationState;
  onPageChange: (page: number) => void;
}) {
  if (pagination.total <= pagination.limit) return null;

  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-white/10 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-gray-500">
        Страница {pagination.page} из {pagination.totalPages} · всего {pagination.total}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPageChange(pagination.page - 1)}
          disabled={pagination.page <= 1}
          className="rounded-lg bg-white/5 px-3 py-2 text-gray-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Назад
        </button>
        <button
          type="button"
          onClick={() => onPageChange(pagination.page + 1)}
          disabled={pagination.page >= pagination.totalPages}
          className="rounded-lg bg-white/5 px-3 py-2 text-gray-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Вперёд →
        </button>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [accounts, setAccounts] = useState<StorageAccount[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [adminFiles, setAdminFiles] = useState<AdminFile[]>([]);
  const [usersPagination, setUsersPagination] = useState<PaginationState>({ page: 1, limit: ADMIN_PAGE_SIZE, total: 0, totalPages: 1 });
  const [filesPagination, setFilesPagination] = useState<PaginationState>({ page: 1, limit: ADMIN_PAGE_SIZE, total: 0, totalPages: 1 });
  const [usersPage, setUsersPage] = useState(1);
  const [filesPage, setFilesPage] = useState(1);
  const [userSearchInput, setUserSearchInput] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [userStatus, setUserStatus] = useState<"all" | "active" | "blocked">("all");
  const [fileSearchInput, setFileSearchInput] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [fileStatus, setFileStatus] = useState<"all" | "active" | "revoked" | "expired">("all");
  const [fileActionToken, setFileActionToken] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<AdminAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    botToken: "",
    channelId: "",
  });
  const [submitting, setSubmitting] = useState(false);
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

      const userParams = new URLSearchParams({ page: String(usersPage), limit: String(ADMIN_PAGE_SIZE) });
      if (userQuery) userParams.set("q", userQuery);
      if (userStatus !== "all") userParams.set("status", userStatus);
      const usersResponse = await fetch(`/api/admin/users?${userParams.toString()}`);
      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        setUsers(usersData.users);
        setUsersPagination({
          page: usersData.page,
          limit: usersData.limit,
          total: usersData.total,
          totalPages: usersData.totalPages,
        });
      }

      const fileParams = new URLSearchParams({ page: String(filesPage), limit: String(ADMIN_PAGE_SIZE) });
      if (fileQuery) fileParams.set("q", fileQuery);
      if (fileStatus !== "all") fileParams.set("status", fileStatus);
      const filesResponse = await fetch(`/api/admin/files?${fileParams.toString()}`);
      if (filesResponse.ok) {
        const filesData = await filesResponse.json();
        setAdminFiles(filesData.files);
        setFilesPagination({
          page: filesData.page,
          limit: filesData.limit,
          total: filesData.total,
          totalPages: filesData.totalPages,
        });
      }
      const auditResponse = await fetch("/api/admin/audit?limit=50");
      if (auditResponse.ok) setAuditEvents((await auditResponse.json()).events);

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
  }, [fileQuery, fileStatus, filesPage, getHeaders, userQuery, userStatus, usersPage]);

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

  const submitUserSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setUsersPage(1);
    setUserQuery(userSearchInput.trim());
  };

  const clearUserSearch = () => {
    setUserSearchInput("");
    setUserQuery("");
    setUserStatus("all");
    setUsersPage(1);
  };

  const submitFileSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setFilesPage(1);
    setFileQuery(fileSearchInput.trim());
  };

  const clearFileSearch = () => {
    setFileSearchInput("");
    setFileQuery("");
    setFileStatus("all");
    setFilesPage(1);
  };

  const updateFile = async (file: AdminFile, action: "revoke" | "restore") => {
    setFileActionToken(file.token);
    setError(null);
    try {
      const response = await fetch("/api/admin/files", {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ token: file.token, action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось изменить файл");
      setSuccess(action === "revoke" ? "Ссылка отозвана" : "Ссылка восстановлена");
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить файл");
    } finally {
      setFileActionToken(null);
    }
  };

  const deleteFile = async (file: AdminFile) => {
    if (!confirm(`Удалить файл «${file.original_name}» из Telegram и FileShare?`)) return;
    setFileActionToken(file.token);
    setError(null);
    try {
      const response = await fetch(`/api/admin/files?token=${encodeURIComponent(file.token)}`, {
        method: "DELETE",
        headers: getHeaders(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось удалить файл");
      setSuccess("Файл удалён из Telegram и FileShare");
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить файл");
    } finally {
      setFileActionToken(null);
    }
  };

  const getFileStatus = (file: AdminFile): "active" | "revoked" | "expired" => {
    if (file.revoked_at || file.group_revoked_at) return "revoked";
    if (file.expires_at && new Date(file.expires_at) <= new Date()) return "expired";
    return "active";
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
    <div className="max-w-6xl mx-auto px-4 py-12 animate-fade-in">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">
            Админ<span className="gradient-text">-панель</span>
          </h1>
          <p className="text-gray-400 mt-1">
            Пользователи, файлы и Telegram-хранилища в одном месте
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

      {(
        <div className="glass rounded-2xl p-5 mb-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between mb-5">
            <div>
              <h3 className="font-medium">Пользователи и лимиты</h3>
              <p className="text-xs text-gray-500 mt-1">Роли, доступ, квоты и текущая загрузка</p>
            </div>
            <form onSubmit={submitUserSearch} className="flex flex-col sm:flex-row gap-2 lg:min-w-[520px]">
              <input
                value={userSearchInput}
                onChange={(event) => setUserSearchInput(event.target.value)}
                placeholder="Поиск по email"
                aria-label="Поиск пользователей"
                className="min-w-0 flex-1 bg-surface-overlay border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/50"
              />
              <ThemedSelect
                value={userStatus}
                options={[{ value: "all", label: "Все" }, { value: "active", label: "Активные" }, { value: "blocked", label: "Заблокированные" }]}
                onChange={(value) => { setUserStatus(value as typeof userStatus); setUsersPage(1); }}
                ariaLabel="Фильтр пользователей по статусу"
              />
              <button type="submit" className="px-3 py-2 rounded-lg bg-accent/20 text-accent-light text-sm hover:bg-accent/30">Найти</button>
              {(userQuery || userStatus !== "all") && <button type="button" onClick={clearUserSearch} className="px-3 py-2 rounded-lg bg-white/5 text-gray-300 text-sm hover:bg-white/10">Сбросить</button>}
            </form>
          </div>
          <div className="space-y-4">
            {users.map((user) => (
              <div key={user.id} className="rounded-xl border border-white/10 p-4">
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{user.email}</p>
                    <p className="text-xs text-gray-500 mt-1">{user.files_count} файлов · {formatFileSize(user.storage_used)} · {user.blocked_at ? "заблокирован" : "активен"} · регистрация {new Date(user.created_at).toLocaleDateString("ru-RU")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ThemedSelect
                      value={user.role}
                      options={[{ value: "user", label: "Пользователь" }, { value: "admin", label: "Администратор" }]}
                      onChange={(value) => updateUser(user, { role: value })}
                      ariaLabel={`Роль пользователя ${user.email}`}
                    />
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
                    <label key={field} className="text-xs text-gray-500">{label}<input defaultValue={value ?? ""} placeholder="Без лимита" type="number" min="1" onBlur={(event) => { const next = event.target.value; if (String(value ?? "") !== next) updateUser(user, { [field]: next || null }); }} className="mt-1 w-full bg-surface-overlay border border-white/10 rounded-lg px-2.5 py-2 text-sm text-gray-300" /></label>
                  ))}
                </div>
              </div>
            ))}
            {users.length === 0 && <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-gray-500">Пользователи не найдены</p>}
          </div>
          <Pagination pagination={usersPagination} onPageChange={setUsersPage} />
        </div>
      )}

      {(
        <div className="glass rounded-2xl p-5 mb-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between mb-5">
            <div>
              <h3 className="font-medium">Управление файлами</h3>
              <p className="text-xs text-gray-500 mt-1">Обзор всех файлов · поиск, контроль ссылок и удаление из Telegram</p>
            </div>
            <form onSubmit={submitFileSearch} className="flex flex-col sm:flex-row gap-2 lg:min-w-[620px]">
              <input
                value={fileSearchInput}
                onChange={(event) => setFileSearchInput(event.target.value)}
                placeholder="Имя файла или email владельца"
                aria-label="Поиск файлов"
                className="min-w-0 flex-1 bg-surface-overlay border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/50"
              />
              <ThemedSelect
                value={fileStatus}
                options={[{ value: "all", label: "Все" }, { value: "active", label: "Активные" }, { value: "revoked", label: "Отозванные" }, { value: "expired", label: "Истёкшие" }]}
                onChange={(value) => { setFileStatus(value as typeof fileStatus); setFilesPage(1); }}
                ariaLabel="Фильтр файлов по статусу"
              />
              <button type="submit" className="px-3 py-2 rounded-lg bg-accent/20 text-accent-light text-sm hover:bg-accent/30">Найти</button>
              {(fileQuery || fileStatus !== "all") && <button type="button" onClick={clearFileSearch} className="px-3 py-2 rounded-lg bg-white/5 text-gray-300 text-sm hover:bg-white/10">Сбросить</button>}
            </form>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500"><tr><th className="pb-3 pr-4">Файл</th><th className="pb-3 pr-4">Владелец</th><th className="pb-3 pr-4">Размер</th><th className="pb-3 pr-4">Скачивания</th><th className="pb-3 pr-4">Статус</th><th className="pb-3">Действия</th></tr></thead>
              <tbody>{adminFiles.length === 0 ? <tr><td colSpan={6} className="py-8 text-center text-sm text-gray-500">Файлы не найдены</td></tr> : adminFiles.map((file) => {
                const status = getFileStatus(file);
                const busy = fileActionToken === file.token;
                return <tr key={file.token} className="border-t border-white/5 align-top">
                  <td className="py-3 pr-4 max-w-[260px]" title={file.original_name}>
                    <p className="truncate">{file.original_name}{file.content_encryption === "e2ee-v1" && <span className="ml-2 text-xs text-accent-light">E2EE</span>}</p>
                    <p className="text-[11px] text-gray-600 mt-1 font-mono truncate">{file.token}</p>
                  </td>
                  <td className="py-3 pr-4 text-gray-400">{file.owner_email || "Гость"}{file.group_token && <p className="text-[11px] text-gray-600 mt-1">групповая ссылка</p>}</td>
                  <td className="py-3 pr-4 text-gray-400 whitespace-nowrap">{formatFileSize(file.size)}</td>
                  <td className="py-3 pr-4 text-gray-400 whitespace-nowrap">{file.download_count}{file.max_downloads ? ` / ${file.max_downloads}` : ""}</td>
                  <td className="py-3 pr-4 whitespace-nowrap"><span className={status === "active" ? "text-green-400" : status === "revoked" ? "text-red-400" : "text-amber-400"}>{status === "active" ? "Активен" : status === "revoked" ? "Отозван" : "Истёк"}</span>{file.deletion_attempts > 0 && <p className="text-[11px] text-amber-400 mt-1">ошибок удаления: {file.deletion_attempts}</p>}</td>
                  <td className="py-3"><div className="flex flex-wrap gap-2 min-w-[190px]">
                    <Link href={`/f/${file.token}`} target="_blank" className="px-2.5 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10">Открыть</Link>
                    {status === "revoked" ? <button type="button" disabled={busy} onClick={() => updateFile(file, "restore")} className="px-2.5 py-1.5 rounded-lg text-xs bg-green-500/10 text-green-400 hover:bg-green-500/20 disabled:opacity-50">Восстановить</button> : <button type="button" disabled={busy} onClick={() => updateFile(file, "revoke")} className="px-2.5 py-1.5 rounded-lg text-xs bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 disabled:opacity-50">Отозвать</button>}
                    <button type="button" disabled={busy} onClick={() => deleteFile(file)} className="px-2.5 py-1.5 rounded-lg text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50">Удалить файл</button>
                  </div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <Pagination pagination={filesPagination} onPageChange={setFilesPage} />
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
