"use client";

import { useEffect, useState } from "react";
import { formatFileSize } from "@/lib/utils";
import ThemedSelect from "@/components/ThemedSelect";

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

interface PaginationState {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const PAGE_SIZE = 20;

function Pagination({ pagination, onPageChange }: { pagination: PaginationState; onPageChange: (page: number) => void }) {
  if (pagination.total <= pagination.limit) return null;

  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-white/10 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-gray-500">Страница {pagination.page} из {pagination.totalPages} · всего {pagination.total}</span>
      <div className="flex gap-2">
        <button type="button" onClick={() => onPageChange(pagination.page - 1)} disabled={pagination.page <= 1} className="rounded-lg bg-white/5 px-3 py-2 text-gray-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">← Назад</button>
        <button type="button" onClick={() => onPageChange(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages} className="rounded-lg bg-white/5 px-3 py-2 text-gray-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">Вперёд →</button>
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "blocked">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (query) params.set("q", query);
    if (status !== "all") params.set("status", status);

    setLoading(true);
    fetch(`/api/admin/users?${params.toString()}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Не удалось загрузить пользователей");
        return data as { users: AdminUser[]; page: number; limit: number; total: number; totalPages: number };
      })
      .then((data) => {
        setUsers(data.users);
        setPagination({ page: data.page, limit: data.limit, total: data.total, totalPages: data.totalPages });
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Ошибка загрузки пользователей"))
      .finally(() => setLoading(false));
  }, [page, query, status]);

  const updateUser = async (user: AdminUser, data: Record<string, unknown>) => {
    setError(null);
    setSuccess(null);
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: user.id, ...data }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.error || "Не удалось изменить пользователя");
      return;
    }
    setSuccess("Настройки пользователя обновлены");
    setPage((current) => current);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (query) params.set("q", query);
    if (status !== "all") params.set("status", status);
    const refreshed = await fetch(`/api/admin/users?${params.toString()}`).then((res) => res.json());
    setUsers(refreshed.users);
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setQuery(searchInput.trim());
  };

  const clearSearch = () => {
    setSearchInput("");
    setQuery("");
    setStatus("all");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Пользователи</h2>
        <p className="text-gray-400 mt-1">Роли, доступ, квоты и текущая загрузка аккаунтов</p>
      </div>

      {error && <div className="glass rounded-xl p-4 border border-red-500/30 bg-red-500/10"><p className="text-red-400 text-sm">{error}</p></div>}
      {success && <div className="glass rounded-xl p-4 border border-green-500/30 bg-green-500/10"><p className="text-green-400 text-sm">{success}</p></div>}

      <div className="glass rounded-2xl p-4 sm:p-5">
        <form onSubmit={submitSearch} className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Поиск по email" aria-label="Поиск пользователей" className="min-w-0 flex-1 bg-surface-overlay border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent/50" />
          <ThemedSelect value={status} options={[{ value: "all", label: "Все" }, { value: "active", label: "Активные" }, { value: "blocked", label: "Заблокированные" }]} onChange={(value) => { setStatus(value as typeof status); setPage(1); }} ariaLabel="Фильтр пользователей по статусу" className="lg:w-48" />
          <button type="submit" className="px-3 py-2.5 rounded-lg bg-accent/20 text-accent-light text-sm hover:bg-accent/30">Найти</button>
          {(query || status !== "all") && <button type="button" onClick={clearSearch} className="px-3 py-2.5 rounded-lg bg-white/5 text-gray-300 text-sm hover:bg-white/10">Сбросить</button>}
        </form>
      </div>

      <div className="glass rounded-2xl p-5">
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-500">Загрузка пользователей...</div>
        ) : (
          <div className="space-y-4">
            {users.map((user) => (
              <div key={`${user.id}-${user.role}-${user.blocked_at ?? "active"}-${user.max_file_size ?? "none"}`} className="rounded-xl border border-white/10 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{user.email}</p>
                    <p className="text-xs text-gray-500 mt-1">{user.files_count} файлов · {formatFileSize(user.storage_used)} · {user.blocked_at ? "заблокирован" : "активен"} · регистрация {new Date(user.created_at).toLocaleDateString("ru-RU")}</p>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <ThemedSelect value={user.role} options={[{ value: "user", label: "Пользователь" }, { value: "admin", label: "Администратор" }]} onChange={(value) => updateUser(user, { role: value })} ariaLabel={`Роль пользователя ${user.email}`} className="w-full sm:min-w-44" />
                    <button type="button" onClick={() => updateUser(user, { blocked: !user.blocked_at })} className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm hover:bg-white/10 sm:w-auto">{user.blocked_at ? "Разблокировать" : "Заблокировать"}</button>
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
                    <label key={field} className="text-xs text-gray-500">
                      {label}
                      <input defaultValue={value ?? ""} placeholder="Без лимита" type="number" min="1" onBlur={(event) => { const next = event.target.value; if (String(value ?? "") !== next) void updateUser(user, { [field]: next || null }); }} className="mt-1 w-full bg-surface-overlay border border-white/10 rounded-lg px-2.5 py-2 text-sm text-gray-300" />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {users.length === 0 && <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-gray-500">Пользователи не найдены</p>}
          </div>
        )}
        <Pagination pagination={pagination} onPageChange={setPage} />
      </div>
    </div>
  );
}
