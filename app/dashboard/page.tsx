"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { EXPIRY_OPTIONS, formatDate, formatFileSize, getFileIcon } from "@/lib/utils";

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

function statusLabel(item: Transfer): string {
  if (item.revoked) return "Отозвана";
  if (item.expired) return "Истекла";
  return "Активна";
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
      if (filesResponse.status === 401 || statsResponse.status === 401 || notificationsResponse.status === 401) {
        setUnauthenticated(true);
        return;
      }
      const filesData = await filesResponse.json();
      const statsData = await statsResponse.json();
      const notificationsData = await notificationsResponse.json();
      if (!filesResponse.ok) throw new Error(filesData.error || "Не удалось загрузить файлы");
      setItems(filesData.items);
      setTotal(filesData.total);
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
    setQr({ name: item.name, dataUrl: await QRCode.toDataURL(item.shareUrl, { width: 280, margin: 2 }) });
  };

  const createShortLink = async (item: Transfer) => {
    if (!item.canRecreateLink) {
      setError("Для E2EE-файла короткая ссылка не может содержать ключ из URL-фрагмента.");
      return;
    }
    const response = await fetch(`/api/user/files/${encodeURIComponent(item.token)}?action=short-link`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error || "Не удалось создать короткую ссылку");
    else if (data.shortUrl) {
      await navigator.clipboard.writeText(data.shortUrl);
      setCopied(item.token);
      window.setTimeout(() => setCopied(null), 1800);
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
    <div className="max-w-5xl mx-auto px-4 py-12 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">Личный <span className="gradient-text">кабинет</span></h1>
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
        <div className="glass rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div><h2 className="font-semibold">Email-уведомления</h2><p className="text-xs text-gray-500 mt-1">Письма отправляются через очередь и не задерживают загрузку.</p></div>
            {notificationSaving && <span className="text-xs text-gray-500">Сохранение...</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <label className="flex items-center gap-2 text-gray-300"><input type="checkbox" checked={notifications.email_enabled === 1} onChange={(event) => updateNotifications({ email_enabled: event.target.checked ? 1 : 0 })} disabled={notificationSaving} /> Все уведомления</label>
            <label className="flex items-center gap-2 text-gray-300"><input type="checkbox" checked={notifications.download_notifications === 1} onChange={(event) => updateNotifications({ download_notifications: event.target.checked ? 1 : 0 })} disabled={notificationSaving} /> О каждом скачивании</label>
            <label className="flex items-center gap-2 text-gray-300"><input type="checkbox" checked={notifications.summary_notifications === 1} onChange={(event) => updateNotifications({ summary_notifications: event.target.checked ? 1 : 0 })} disabled={notificationSaving} /> Сводные уведомления</label>
          </div>
          <label className="flex items-center gap-3 text-sm text-gray-400 mt-4">Предупреждать об окончании за
            <select value={notifications.expiry_warning_days} onChange={(event) => updateNotifications({ expiry_warning_days: Number(event.target.value) })} disabled={notificationSaving} className="bg-surface-overlay border border-white/10 rounded-lg px-2.5 py-2">
              <option value={0}>Не предупреждать</option><option value={1}>1 день</option><option value={2}>2 дня</option><option value={3}>3 дня</option><option value={7}>7 дней</option><option value={14}>14 дней</option><option value={30}>30 дней</option>
            </select>
          </label>
        </div>
      )}

      <div className="glass rounded-2xl p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3">
          <input value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} placeholder="Поиск по названию" className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50" />
          <select value={status} onChange={(event) => { setStatus(event.target.value as Status); setPage(1); }} className="bg-surface-overlay border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent/50">
            <option value="">Все статусы</option><option value="active">Активные</option><option value="expired">Истёкшие</option><option value="revoked">Отозванные</option><option value="password">С паролем</option><option value="e2ee">E2EE</option>
          </select>
          <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }} className="bg-surface-overlay border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-accent/50">
            <option value="created">Новые сначала</option><option value="size">По размеру</option><option value="downloads">По скачиваниям</option>
          </select>
        </div>
      </div>

      {error && <div className="glass rounded-xl p-4 mb-4 border border-red-500/30 bg-red-500/10"><p className="text-red-400 text-sm">{error}</p></div>}
      {loading ? <div className="py-20 text-center"><div className="w-10 h-10 mx-auto border-2 border-accent/30 border-t-accent rounded-full animate-spin" /></div> : items.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center"><div className="text-5xl mb-4">📁</div><h2 className="text-xl font-medium mb-2">Передач пока нет</h2><p className="text-gray-400 text-sm mb-6">Загрузите первый файл после входа в аккаунт.</p><Link href="/" className="inline-block px-5 py-2.5 rounded-xl bg-accent/20 text-accent-light font-medium">Загрузить файл</Link></div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.token} className="glass rounded-2xl p-4 sm:p-5">
              <div className="flex items-start gap-3">
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
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => copyLink(item)} className="px-3 py-2 rounded-lg bg-accent/20 text-accent-light text-sm hover:bg-accent/30">{copied === item.token ? "Скопировано" : item.canRecreateLink ? "Копировать" : "Нет ключа"}</button>
                  <button type="button" onClick={() => showQr(item)} className="px-3 py-2 rounded-lg bg-white/5 text-gray-300 text-sm hover:bg-white/10">QR</button>
                  <button type="button" onClick={() => createShortLink(item)} className="px-3 py-2 rounded-lg bg-white/5 text-gray-300 text-sm hover:bg-white/10">Короткая</button>
                  <button type="button" onClick={() => setEdit({ token: item.token, expiry: "never", password: "", maxDownloads: item.max_downloads ? String(item.max_downloads) : "", clearPassword: false, clearLimit: false })} className="px-3 py-2 rounded-lg bg-white/5 text-gray-300 text-sm hover:bg-white/10">Изменить</button>
                  {!item.revoked ? <button type="button" onClick={() => changeStatus(item, "revoke")} className="px-3 py-2 rounded-lg bg-yellow-500/10 text-yellow-400 text-sm hover:bg-yellow-500/20">Отозвать</button> : <button type="button" onClick={() => changeStatus(item, "restore")} className="px-3 py-2 rounded-lg bg-green-500/10 text-green-400 text-sm hover:bg-green-500/20">Восстановить</button>}
                  <button type="button" onClick={() => deleteItem(item)} className="px-3 py-2 rounded-lg bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20">Удалить</button>
                </div>
              </div>
              {item.expires_at && <p className="text-xs text-gray-500 mt-3">Действует до: {formatDate(item.expires_at)}</p>}
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && <div className="flex items-center justify-center gap-3 mt-6"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="px-4 py-2 rounded-xl bg-white/5 text-sm disabled:opacity-40">Назад</button><span className="text-sm text-gray-400">{page} / {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} className="px-4 py-2 rounded-xl bg-white/5 text-sm disabled:opacity-40">Вперёд</button></div>}

      {edit && <div className="fixed inset-x-0 top-20 z-[60] flex justify-center px-4 pointer-events-none"><div className="glass rounded-2xl p-6 w-full max-w-md shadow-2xl pointer-events-auto"><div className="flex items-center justify-between mb-5"><h2 className="text-xl font-semibold">Настройки ссылки</h2><button type="button" onClick={() => setEdit(null)} className="text-gray-400 hover:text-white">✕</button></div><div className="space-y-4"><div><label className="block text-sm text-gray-400 mb-1.5">Срок действия</label><select value={edit.expiry} onChange={(event) => setEdit({ ...edit, expiry: event.target.value })} className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm"><option value="keep">Не изменять</option>{EXPIRY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><div><label className="block text-sm text-gray-400 mb-1.5">Новый пароль</label><input type="password" value={edit.password} onChange={(event) => setEdit({ ...edit, password: event.target.value, clearPassword: false })} placeholder="Оставить текущий" className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm" /><label className="flex items-center gap-2 text-xs text-gray-400 mt-2"><input type="checkbox" checked={edit.clearPassword} onChange={(event) => setEdit({ ...edit, clearPassword: event.target.checked, password: "" })} /> Убрать пароль</label></div><div><label className="block text-sm text-gray-400 mb-1.5">Лимит скачиваний</label><input type="number" min="1" value={edit.maxDownloads} onChange={(event) => setEdit({ ...edit, maxDownloads: event.target.value, clearLimit: false })} placeholder="Оставить текущий" className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm" /><label className="flex items-center gap-2 text-xs text-gray-400 mt-2"><input type="checkbox" checked={edit.clearLimit} onChange={(event) => setEdit({ ...edit, clearLimit: event.target.checked, maxDownloads: "" })} /> Убрать лимит</label></div><button type="button" onClick={saveEdit} disabled={saving} className="w-full py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium disabled:opacity-50">{saving ? "Сохранение..." : "Сохранить"}</button></div></div></div>}
      {qr && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setQr(null); }}><div className="glass rounded-2xl p-6 w-full max-w-sm text-center shadow-2xl"><h2 className="text-xl font-semibold mb-4">QR-код</h2><div className="rounded-xl bg-white p-3 inline-block"><Image src={qr.dataUrl} alt={`QR-код: ${qr.name}`} width={256} height={256} unoptimized /></div><p className="text-sm text-gray-400 mt-4 break-all">{qr.name}</p><button type="button" onClick={() => setQr(null)} className="mt-5 w-full py-2.5 rounded-xl bg-white/5 text-gray-300">Закрыть</button></div></div>}
    </div>
  );
}
