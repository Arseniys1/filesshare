"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { EXPIRY_OPTIONS, formatDate, formatFileSize, getFileIcon } from "@/lib/utils";
import { copyImageToClipboard } from "@/lib/clipboard";
import ThemedCheckbox from "@/components/ThemedCheckbox";
import ThemedSelect from "@/components/ThemedSelect";

type Status = "active" | "expired" | "revoked" | "password" | "e2ee" | "";

interface Transfer {
  kind: "file" | "group";
  token: string;
  name: string;
  size: number;
  file_count: number;
  expires_at: string | null;
  download_count: number;
  max_downloads: number | null;
  has_password: number;
  storage_encrypted: number;
  content_encryption: "none" | "e2ee-v1";
  created_at: string;
  revoked_at: string | null;
  shareUrl: string;
  canRecreateLink: boolean;
  expired: boolean;
  revoked: boolean;
}

interface Stats {
  transfers: number;
  downloads: number;
  recentDownloads: Array<{ file_name: string; created_at: string; outcome: string }>;
}

interface NotificationSettings {
  email_enabled: number;
  download_notifications: number;
  summary_notifications: number;
  expiry_warning_days: number;
}

interface EditState {
  token: string;
  expiry: string;
  password: string;
  maxDownloads: string;
  clearPassword: boolean;
  clearLimit: boolean;
}

interface EditTransferPanelProps {
  edit: EditState;
  saving: boolean;
  onChange: (patch: Partial<EditState>) => void;
  onSave: () => void;
  onClose: () => void;
}

function EditTransferPanel({ edit, saving, onChange, onSave, onClose }: EditTransferPanelProps) {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-accent/15 bg-surface-overlay shadow-lg shadow-black/5">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-lg text-accent">⚙</div>
          <div>
            <h2 className="text-base font-semibold">Настройки ссылки</h2>
            <p className="mt-0.5 text-xs text-gray-500">Изменения применяются к этой передаче.</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-white/10 hover:text-foreground" aria-label="Закрыть настройки">✕</button>
      </div>
      <div className="p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">Срок действия</label>
            <ThemedSelect
              value={edit.expiry}
              options={[{ value: "keep", label: "Не изменять" }, ...EXPIRY_OPTIONS]}
              onChange={(value) => onChange({ expiry: value })}
              className="w-full"
              ariaLabel="Срок действия"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">Новый пароль</label>
            <input type="password" value={edit.password} onChange={(event) => onChange({ password: event.target.value, clearPassword: false })} placeholder="Оставить текущий" className="w-full rounded-xl border border-white/10 bg-[var(--background)] px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-500 focus:border-accent/50 focus:outline-none focus:ring-4 focus:ring-accent/10" />
            <label className="mt-2.5 flex items-center gap-2 text-xs text-gray-500"><ThemedCheckbox checked={edit.clearPassword} onChange={(event) => onChange({ clearPassword: event.target.checked, password: "" })} /> Убрать пароль</label>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">Лимит скачиваний</label>
            <input type="number" min="1" value={edit.maxDownloads} onChange={(event) => onChange({ maxDownloads: event.target.value, clearLimit: false })} placeholder="Оставить текущий" className="w-full rounded-xl border border-white/10 bg-[var(--background)] px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-500 focus:border-accent/50 focus:outline-none focus:ring-4 focus:ring-accent/10" />
            <label className="mt-2.5 flex items-center gap-2 text-xs text-gray-500"><ThemedCheckbox checked={edit.clearLimit} onChange={(event) => onChange({ clearLimit: event.target.checked, maxDownloads: "" })} /> Убрать лимит</label>
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 border-t border-white/10 pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm text-gray-500 transition-colors hover:bg-white/10 hover:text-foreground">Отмена</button>
          <button type="button" onClick={onSave} disabled={saving} className="rounded-xl bg-gradient-to-r from-accent to-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent/20 transition-opacity hover:opacity-90 disabled:opacity-50">{saving ? "Сохранение..." : "Сохранить"}</button>
        </div>
      </div>
    </div>
  );
}

function statusLabel(item: Transfer): string {
  if (item.revoked) return "Отозвана";
  if (item.expired) return "Истекла";
  return "Активна";
}

function getPaginationPages(totalPages: number, currentPage: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages: Array<number | "ellipsis"> = [1];
  if (currentPage > 3) pages.push("ellipsis");
  for (let pageNumber = Math.max(2, currentPage - 1); pageNumber <= Math.min(totalPages - 1, currentPage + 1); pageNumber += 1) {
    pages.push(pageNumber);
  }
  if (currentPage < totalPages - 2) pages.push("ellipsis");
  pages.push(totalPages);
  return pages;
}

export default function DashboardPage() {
  const [items, setItems] = useState<Transfer[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [notifications, setNotifications] = useState<NotificationSettings | null>(null);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("");
  const [sort, setSort] = useState("created");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [qr, setQr] = useState<{ name: string; dataUrl: string } | null>(null);
  const [qrCopied, setQrCopied] = useState(false);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort });
      if (q.trim()) params.set("q", q.trim());
      if (status) params.set("status", status);
      const [filesResponse, statsResponse, notificationsResponse] = await Promise.all([
        fetch(`/api/user/files?${params}`),
        fetch("/api/user/stats"),
        fetch("/api/user/notifications"),
      ]);
      if (filesResponse.status === 401) {
        setUnauthenticated(true);
        return;
      }
      const filesData = await filesResponse.json();
      const statsData = await statsResponse.json();
      const notificationsData = await notificationsResponse.json();
      if (!filesResponse.ok) throw new Error(filesData.error || "Не удалось загрузить файлы");
      setItems(filesData.items);
      setTotal(filesData.total);
      if (Number.isInteger(filesData.page) && filesData.page >= 1) setPage(filesData.page);
      setStats(statsData);
      if (notificationsResponse.ok) setNotifications(notificationsData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Ошибка загрузки кабинета");
    } finally {
      setLoading(false);
    }
  }, [page, q, sort, status]);

  const updateNotifications = async (patch: Partial<NotificationSettings>) => {
    if (!notifications) return;
    setNotificationSaving(true);
    try {
      const response = await fetch("/api/user/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить настройки уведомлений");
      setNotifications(data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Ошибка сохранения уведомлений");
    } finally {
      setNotificationSaving(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const copyLink = async (item: Transfer) => {
    if (!item.canRecreateLink) {
      setError("Для E2EE-файла ключ находится только в исходной ссылке и не хранится в кабинете.");
      return;
    }
    await navigator.clipboard.writeText(item.shareUrl);
    setCopied(item.token);
    window.setTimeout(() => setCopied(null), 1800);
  };

  const showQr = async (item: Transfer) => {
    if (!item.canRecreateLink) {
      setError("Для E2EE-файла QR-код можно создать только из исходной ссылки с ключом.");
      return;
    }
    setQrCopied(false);
    setQr({ name: item.name, dataUrl: await QRCode.toDataURL(item.shareUrl, { width: 280, margin: 2 }) });
  };

  const copyQr = async () => {
    if (!qr) return;
    try {
      await copyImageToClipboard(qr.dataUrl);
      setQrCopied(true);
      window.setTimeout(() => setQrCopied(false), 1800);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "Не удалось скопировать QR-код");
    }
  };

  const changeStatus = async (item: Transfer, action: "revoke" | "restore") => {
    const response = await fetch(`/api/user/files/${encodeURIComponent(item.token)}?action=${action}`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error || "Не удалось изменить статус ссылки");
    else load();
  };

  const deleteItem = async (item: Transfer) => {
    if (!window.confirm(`Удалить «${item.name}» из Telegram и FileShare?`)) return;
    const response = await fetch(`/api/user/files/${encodeURIComponent(item.token)}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error || "Не удалось удалить передачу");
    else load();
  };

  const saveEdit = async () => {
    if (!edit) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { expiry: edit.expiry };
      if (edit.clearPassword) body.password = null;
      else if (edit.password) body.password = edit.password;
      if (edit.clearLimit) body.maxDownloads = null;
      else if (edit.maxDownloads) body.maxDownloads = edit.maxDownloads;
      const response = await fetch(`/api/user/files/${encodeURIComponent(edit.token)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить изменения");
      setEdit(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  if (unauthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-32">
        <div className="glass rounded-2xl p-8 text-center gradient-border">
          <h1 className="text-2xl font-bold mb-3">Личный кабинет</h1>
          <p className="text-gray-400 text-sm mb-6">Войдите, чтобы увидеть свои передачи.</p>
          <Link href="/login?next=/dashboard" className="block py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium">Войти</Link>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  return (
    <div className="mx-auto max-w-5xl px-3 py-8 animate-fade-in sm:px-4 sm:py-12">
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Личный <span className="gradient-text">кабинет</span></h1>
          <p className="text-gray-400 mt-1">Управление файлами и ссылками</p>
        </div>
        <Link href="/" className="self-start sm:self-auto px-4 py-2.5 rounded-xl bg-accent/20 text-accent-light text-sm font-medium hover:bg-accent/30">Новая загрузка</Link>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <div className="glass rounded-xl p-4"><p className="text-2xl font-bold gradient-text">{stats.transfers}</p><p className="text-sm text-gray-400">Передач</p></div>
          <div className="glass rounded-xl p-4"><p className="text-2xl font-bold gradient-text">{stats.downloads}</p><p className="text-sm text-gray-400">Скачиваний</p></div>
          <div className="glass rounded-xl p-4 col-span-2 sm:col-span-1"><p className="text-2xl font-bold gradient-text">{stats.recentDownloads.length}</p><p className="text-sm text-gray-400">Последних событий</p></div>
        </div>
      )}

      {notifications && (
        <div className="glass mb-6 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div><h2 className="font-semibold">Email-уведомления</h2></div>
            {notificationSaving && <span className="text-xs text-gray-500">Сохранение...</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <label className="flex items-center gap-2 text-gray-300"><ThemedCheckbox checked={notifications.email_enabled === 1} onChange={(event) => updateNotifications({ email_enabled: event.target.checked ? 1 : 0 })} disabled={notificationSaving} /> Все уведомления</label>
            <label className="flex items-center gap-2 text-gray-300"><ThemedCheckbox checked={notifications.download_notifications === 1} onChange={(event) => updateNotifications({ download_notifications: event.target.checked ? 1 : 0 })} disabled={notificationSaving} /> О каждом скачивании</label>
            <label className="flex items-center gap-2 text-gray-300"><ThemedCheckbox checked={notifications.summary_notifications === 1} onChange={(event) => updateNotifications({ summary_notifications: event.target.checked ? 1 : 0 })} disabled={notificationSaving} /> Сводные уведомления</label>
          </div>
          <label className="mt-4 flex flex-wrap items-center gap-3 text-sm text-gray-400">Предупреждать об окончании за
            <ThemedSelect
              value={String(notifications.expiry_warning_days)}
              options={[{ value: "0", label: "Не предупреждать" }, { value: "1", label: "1 день" }, { value: "2", label: "2 дня" }, { value: "3", label: "3 дня" }, { value: "7", label: "7 дней" }, { value: "14", label: "14 дней" }, { value: "30", label: "30 дней" }]}
              onChange={(value) => updateNotifications({ expiry_warning_days: Number(value) })}
              disabled={notificationSaving}
              ariaLabel="Срок предупреждения об окончании"
            />
          </label>
        </div>
      )}

      <div className="glass rounded-2xl p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3">
          <input value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} placeholder="Поиск по названию" className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50" />
          <ThemedSelect
            value={status}
            options={[{ value: "", label: "Все статусы" }, { value: "active", label: "Активные" }, { value: "expired", label: "Истёкшие" }, { value: "revoked", label: "Отозванные" }, { value: "password", label: "С паролем" }, { value: "e2ee", label: "E2EE" }]}
            onChange={(value) => { setStatus(value as Status); setPage(1); }}
              className="w-full sm:w-40"
            ariaLabel="Фильтр по статусу"
          />
          <ThemedSelect
            value={sort}
            options={[{ value: "created", label: "Новые сначала" }, { value: "size", label: "По размеру" }, { value: "downloads", label: "По скачиваниям" }]}
            onChange={(value) => { setSort(value); setPage(1); }}
            className="w-full"
            ariaLabel="Сортировка файлов"
          />
        </div>
      </div>

      {error && <div className="glass rounded-xl p-4 mb-4 border border-red-500/30 bg-red-500/10"><p className="text-red-400 text-sm">{error}</p></div>}
      {loading && items.length === 0 ? <div className="py-20 text-center"><div className="w-10 h-10 mx-auto border-2 border-accent/30 border-t-accent rounded-full animate-spin" /></div> : items.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center"><div className="text-5xl mb-4">📁</div><h2 className="text-xl font-medium mb-2">Передач пока нет</h2><p className="text-gray-400 text-sm mb-6">Загрузите первый файл после входа в аккаунт.</p><Link href="/" className="inline-block px-5 py-2.5 rounded-xl bg-accent/20 text-accent-light font-medium">Загрузить файл</Link></div>
      ) : (
        <div className={`relative transition-opacity ${loading ? "opacity-65" : ""}`}>
          {loading && <div className="absolute -top-8 right-1 flex items-center gap-2 text-xs text-gray-500"><span className="inline-block h-3 w-3 animate-spin rounded-full border border-accent/30 border-t-accent" /> Обновляем список</div>}
          <div className="space-y-3">
          {items.map((item) => (
            <div key={item.token} className="glass rounded-2xl p-4 sm:p-5">
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:gap-3">
                <div className="w-11 h-11 rounded-xl bg-accent/15 flex items-center justify-center text-xl flex-shrink-0">{item.kind === "group" ? "📦" : getFileIcon(item.content_encryption === "e2ee-v1" ? "application/octet-stream" : "application/octet-stream")}</div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate" title={item.name}>{item.name}</p>
                  <p className="text-sm text-gray-400 mt-1">{formatFileSize(item.size)} · {item.file_count} {item.file_count === 1 ? "файл" : "файлов"} · {formatDate(item.created_at)}</p>
                  <div className="flex flex-wrap gap-2 mt-2 text-xs">
                    <span className={`rounded-full px-2 py-1 ${item.revoked ? "bg-red-500/15 text-red-400" : item.expired ? "bg-yellow-500/15 text-yellow-400" : "bg-green-500/15 text-green-400"}`}>{statusLabel(item)}</span>
                    {item.has_password === 1 && <span className="rounded-full px-2 py-1 bg-white/5 text-gray-400">🔒 Пароль</span>}
                    {item.content_encryption === "e2ee-v1" && <span className="rounded-full px-2 py-1 bg-accent/15 text-accent-light">🔐 E2EE</span>}
                    <span className="rounded-full px-2 py-1 bg-white/5 text-gray-400">Скачано: {item.download_count}{item.max_downloads ? ` / ${item.max_downloads}` : ""}</span>
                  </div>
                </div>
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
                  <button type="button" onClick={() => copyLink(item)} className="w-full rounded-lg bg-accent/20 px-3 py-2 text-sm text-accent-light hover:bg-accent/30 sm:w-auto">{copied === item.token ? "Скопировано" : item.canRecreateLink ? "Копировать" : "Нет ключа"}</button>
                  <button type="button" onClick={() => showQr(item)} className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-gray-300 hover:bg-white/10 sm:w-auto">QR</button>
                  <button type="button" onClick={() => setEdit({ token: item.token, expiry: "keep", password: "", maxDownloads: item.max_downloads ? String(item.max_downloads) : "", clearPassword: false, clearLimit: false })} className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-gray-300 hover:bg-white/10 sm:w-auto">Изменить</button>
                  {!item.revoked ? <button type="button" onClick={() => changeStatus(item, "revoke")} className="w-full rounded-lg bg-yellow-500/10 px-3 py-2 text-sm text-yellow-400 hover:bg-yellow-500/20 sm:w-auto">Отозвать</button> : <button type="button" onClick={() => changeStatus(item, "restore")} className="w-full rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-400 hover:bg-green-500/20 sm:w-auto">Восстановить</button>}
                  <button type="button" onClick={() => deleteItem(item)} className="w-full rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400 hover:bg-red-500/20 sm:w-auto">Удалить</button>
                </div>
              </div>
              {item.expires_at && <p className="text-xs text-gray-500 mt-3">Действует до: {formatDate(item.expires_at)}</p>}
              {edit?.token === item.token && (
                <EditTransferPanel
                  edit={edit}
                  saving={saving}
                  onChange={(patch) => setEdit({ ...edit, ...patch })}
                  onSave={saveEdit}
                  onClose={() => setEdit(null)}
                />
              )}
            </div>
          ))}
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <nav aria-label="Пагинация файлов" className="mt-6 flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-sm text-gray-500">
            Показано {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} из {total}
          </p>
          <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5 sm:justify-end">
            <button
              type="button"
              aria-label="Предыдущая страница"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
              className="rounded-xl bg-white/5 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Назад
            </button>
            <div className="flex items-center gap-1" aria-label="Страницы списка">
              {getPaginationPages(totalPages, page).map((pageNumber, index) => (
                pageNumber === "ellipsis" ? (
                  <span key={`ellipsis-${index}`} aria-hidden="true" className="px-1 text-gray-500">…</span>
                ) : (
                  <button
                    key={pageNumber}
                    type="button"
                    aria-label={`Страница ${pageNumber}`}
                    aria-current={pageNumber === page ? "page" : undefined}
                    onClick={() => setPage(pageNumber)}
                    className={`h-9 min-w-9 rounded-xl px-2 text-sm transition-colors ${pageNumber === page ? "bg-accent text-white" : "bg-white/5 text-gray-300 hover:bg-white/10"}`}
                  >
                    {pageNumber}
                  </button>
                )
              ))}
            </div>
            <button
              type="button"
              aria-label="Следующая страница"
              disabled={page >= totalPages}
              onClick={() => setPage((value) => value + 1)}
              className="rounded-xl bg-white/5 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Вперёд
            </button>
          </div>
        </nav>
      )}

      {qr && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-3 py-4 sm:px-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setQr(null); }}><div className="glass max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl p-4 text-center shadow-2xl sm:p-6"><h2 className="mb-4 text-xl font-semibold">QR-код</h2><div className="inline-block max-w-full rounded-xl bg-white p-3"><Image className="h-auto max-w-full" src={qr.dataUrl} alt={`QR-код: ${qr.name}`} width={256} height={256} unoptimized /></div><p className="mt-4 break-all text-sm text-gray-400">{qr.name}</p><div className="mt-5 flex flex-col gap-2 sm:flex-row"><button type="button" onClick={copyQr} className="flex-1 rounded-xl bg-accent/20 py-2.5 text-sm font-medium text-accent-light hover:bg-accent/30">{qrCopied ? "QR-код скопирован" : "Копировать QR"}</button><button type="button" onClick={() => setQr(null)} className="flex-1 rounded-xl bg-white/5 py-2.5 text-sm text-gray-300">Закрыть</button></div></div></div>}
    </div>
  );
}
