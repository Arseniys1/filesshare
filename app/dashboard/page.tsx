"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import QRCode from "qrcode";
import {
  formatDate,
  formatFileSize,
  getFileIcon,
} from "@/lib/utils";
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
  recentDownloads: Array<{
    file_name: string;
    created_at: string;
    outcome: string;
  }>;
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

function EditTransferPanel({
  edit,
  saving,
  onChange,
  onSave,
  onClose,
}: EditTransferPanelProps) {
  const t = useTranslations("dashboard");
  const uploadT = useTranslations("upload");
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-accent/15 bg-surface-overlay shadow-lg shadow-black/5">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-lg text-accent">
            ⚙
          </div>
          <div>
            <h2 className="text-base font-semibold">{t("linkSettings")}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{t("changesApply")}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-white/10 hover:text-foreground"
          aria-label={t("closeSettings")}
        >
          ✕
        </button>
      </div>
      <div className="p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
              {t("expiresAt")}
            </label>
            <ThemedSelect
              value={edit.expiry}
              options={[
                { value: "keep", label: t("keep") },
                { value: "1h", label: uploadT("expiryOptions.1h") },
                { value: "24h", label: uploadT("expiryOptions.24h") },
                { value: "7d", label: uploadT("expiryOptions.7d") },
                { value: "30d", label: uploadT("expiryOptions.30d") },
                { value: "never", label: uploadT("unlimited") },
              ]}
              onChange={(value) => onChange({ expiry: value })}
              className="w-full"
              ariaLabel={t("expiresAt")}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
              {t("newPassword")}
            </label>
            <input
              type="password"
              value={edit.password}
              onChange={(event) =>
                onChange({ password: event.target.value, clearPassword: false })
              }
              placeholder={t("keepCurrent")}
              className="w-full rounded-xl border border-white/10 bg-[var(--background)] px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-500 focus:border-accent/50 focus:outline-none focus:ring-4 focus:ring-accent/10"
            />
            <label className="mt-2.5 flex items-center gap-2 text-xs text-gray-500">
              <ThemedCheckbox
                checked={edit.clearPassword}
                onChange={(event) =>
                  onChange({
                    clearPassword: event.target.checked,
                    password: "",
                  })
                }
              />{" "}
              {t("removePassword")}
            </label>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
              {t("downloads")}
            </label>
            <input
              type="number"
              min="1"
              value={edit.maxDownloads}
              onChange={(event) =>
                onChange({
                  maxDownloads: event.target.value,
                  clearLimit: false,
                })
              }
              placeholder={t("keepCurrent")}
              className="w-full rounded-xl border border-white/10 bg-[var(--background)] px-3.5 py-2.5 text-sm transition-colors placeholder:text-gray-500 focus:border-accent/50 focus:outline-none focus:ring-4 focus:ring-accent/10"
            />
            <label className="mt-2.5 flex items-center gap-2 text-xs text-gray-500">
              <ThemedCheckbox
                checked={edit.clearLimit}
                onChange={(event) =>
                  onChange({
                    clearLimit: event.target.checked,
                    maxDownloads: "",
                  })
                }
              />{" "}
              {t("removeLimit")}
            </label>
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 border-t border-white/10 pt-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm text-gray-500 transition-colors hover:bg-white/10 hover:text-foreground"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-xl bg-gradient-to-r from-accent to-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent/20 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function statusLabel(
  item: Transfer,
  labels: { revoked: string; expired: string; active: string },
): string {
  if (item.revoked) return labels.revoked;
  if (item.expired) return labels.expired;
  return labels.active;
}

function getPaginationPages(
  totalPages: number,
  currentPage: number,
): Array<number | "ellipsis"> {
  if (totalPages <= 7)
    return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages: Array<number | "ellipsis"> = [1];
  if (currentPage > 3) pages.push("ellipsis");
  for (
    let pageNumber = Math.max(2, currentPage - 1);
    pageNumber <= Math.min(totalPages - 1, currentPage + 1);
    pageNumber += 1
  ) {
    pages.push(pageNumber);
  }
  if (currentPage < totalPages - 2) pages.push("ellipsis");
  pages.push(totalPages);
  return pages;
}

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const navT = useTranslations("nav");
  const locale = useLocale();
  const [items, setItems] = useState<Transfer[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
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
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sort,
      });
      if (q.trim()) params.set("q", q.trim());
      if (status) params.set("status", status);
      const [filesResponse, statsResponse] = await Promise.all([
        fetch(`/api/user/files?${params}`),
        fetch("/api/user/stats"),
      ]);
      if (filesResponse.status === 401) {
        setUnauthenticated(true);
        return;
      }
      const filesData = await filesResponse.json();
      const statsData = await statsResponse.json();
      if (!filesResponse.ok) throw new Error(filesData.error || t("files"));
      setItems(filesData.items);
      setTotal(filesData.total);
      if (Number.isInteger(filesData.page) && filesData.page >= 1)
        setPage(filesData.page);
      setStats(statsData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("cabinet"));
    } finally {
      setLoading(false);
    }
  }, [page, q, sort, status, t]);

  useEffect(() => {
    load();
  }, [load]);

  const copyLink = async (item: Transfer) => {
    if (!item.canRecreateLink) {
      setError(t("e2eeLinkOnly"));
      return;
    }
    await navigator.clipboard.writeText(item.shareUrl);
    setCopied(item.token);
    window.setTimeout(() => setCopied(null), 1800);
  };

  const showQr = async (item: Transfer) => {
    if (!item.canRecreateLink) {
      setError(t("e2eeQrOnly"));
      return;
    }
    setQrCopied(false);
    setQr({
      name: item.name,
      dataUrl: await QRCode.toDataURL(item.shareUrl, { width: 280, margin: 2 }),
    });
  };

  const copyQr = async () => {
    if (!qr) return;
    try {
      await copyImageToClipboard(qr.dataUrl);
      setQrCopied(true);
      window.setTimeout(() => setQrCopied(false), 1800);
    } catch (copyError) {
      setError(
        copyError instanceof Error ? copyError.message : t("qrCopyError"),
      );
    }
  };

  const changeStatus = async (item: Transfer, action: "revoke" | "restore") => {
    const response = await fetch(
      `/api/user/files/${encodeURIComponent(item.token)}?action=${action}`,
      { method: "POST" },
    );
    if (!response.ok) setError(t("edit"));
    else load();
  };

  const deleteItem = async (item: Transfer) => {
    if (!window.confirm(t("deleteConfirm", { name: item.name }))) return;
    const response = await fetch(
      `/api/user/files/${encodeURIComponent(item.token)}`,
      { method: "DELETE" },
    );
    if (!response.ok) setError(t("delete"));
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
      const response = await fetch(
        `/api/user/files/${encodeURIComponent(edit.token)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error(t("save"));
      setEdit(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("save"));
    } finally {
      setSaving(false);
    }
  };

  if (unauthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-32">
        <div className="glass rounded-2xl p-8 text-center gradient-border">
          <h1 className="text-2xl font-bold mb-3">{t("cabinet")}</h1>
          <p className="text-gray-400 text-sm mb-6">{t("loginRequired")}</p>
          <Link
            href="/login?next=/dashboard"
            className="block py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium"
          >
            {navT("login")}
          </Link>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  return (
    <div className="mx-auto max-w-5xl px-3 py-8 animate-fade-in sm:px-4 sm:py-12">
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">{t("cabinet")}</h1>
          <p className="text-gray-400 mt-1">{t("cabinetDescription")}</p>
        </div>
        <Link
          href="/"
          className="self-start sm:self-auto px-4 py-2.5 rounded-xl bg-accent/20 text-accent-light text-sm font-medium hover:bg-accent/30"
        >
          {t("newUpload")}
        </Link>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <div className="glass rounded-xl p-4">
            <p className="text-2xl font-bold gradient-text">
              {stats.transfers}
            </p>
            <p className="text-sm text-gray-400">{t("transfers")}</p>
          </div>
          <div className="glass rounded-xl p-4">
            <p className="text-2xl font-bold gradient-text">
              {stats.downloads}
            </p>
            <p className="text-sm text-gray-400">{t("downloads")}</p>
          </div>
          <div className="glass rounded-xl p-4 col-span-2 sm:col-span-1">
            <p className="text-2xl font-bold gradient-text">
              {stats.recentDownloads.length}
            </p>
            <p className="text-sm text-gray-400">{t("recentEvents")}</p>
          </div>
        </div>
      )}

      <div className="glass rounded-2xl p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3">
          <input
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
            placeholder={t("searchByName")}
            className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50"
          />
          <ThemedSelect
            value={status}
            options={[
              { value: "", label: t("allStatuses") },
              { value: "active", label: t("activeStatuses") },
              { value: "expired", label: t("expiredStatuses") },
              { value: "revoked", label: t("revokedStatuses") },
              { value: "password", label: t("withPassword") },
              { value: "e2ee", label: "E2EE" },
            ]}
            onChange={(value) => {
              setStatus(value as Status);
              setPage(1);
            }}
            className="w-full sm:w-40"
            ariaLabel={t("allStatuses")}
          />
          <ThemedSelect
            value={sort}
            options={[
              { value: "created", label: t("newestFirst") },
              { value: "size", label: t("bySize") },
              { value: "downloads", label: t("byDownloads") },
            ]}
            onChange={(value) => {
              setSort(value);
              setPage(1);
            }}
            className="w-full"
            ariaLabel={t("bySize")}
          />
        </div>
      </div>

      {error && (
        <div className="glass rounded-xl p-4 mb-4 border border-red-500/30 bg-red-500/10">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
      {loading && items.length === 0 ? (
        <div className="py-20 text-center">
          <div className="w-10 h-10 mx-auto border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <div className="text-5xl mb-4">📁</div>
          <h2 className="text-xl font-medium mb-2">{t("noTransfers")}</h2>
          <p className="text-gray-400 text-sm mb-6">{t("firstFile")}</p>
          <Link
            href="/"
            className="inline-block px-5 py-2.5 rounded-xl bg-accent/20 text-accent-light font-medium"
          >
            {t("uploadFile")}
          </Link>
        </div>
      ) : (
        <div
          className={`relative transition-opacity ${loading ? "opacity-65" : ""}`}
        >
          {loading && (
            <div className="absolute -top-8 right-1 flex items-center gap-2 text-xs text-gray-500">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border border-accent/30 border-t-accent" />{" "}
              {t("refreshing")}
            </div>
          )}
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.token} className="glass rounded-2xl p-4 sm:p-5">
                <div className="flex flex-col items-start gap-4 sm:flex-row sm:gap-3">
                  <div className="w-11 h-11 rounded-xl bg-accent/15 flex items-center justify-center text-xl flex-shrink-0">
                    {item.kind === "group"
                      ? "📦"
                      : getFileIcon(
                          item.content_encryption === "e2ee-v1"
                            ? "application/octet-stream"
                            : "application/octet-stream",
                        )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate" title={item.name}>
                      {item.name}
                    </p>
                    <p className="text-sm text-gray-400 mt-1">
                      {formatFileSize(item.size)} · {item.file_count}{" "}
                      {item.file_count === 1 ? t("file") : t("files")} ·{" "}
                      {formatDate(item.created_at, locale)}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs">
                      <span
                        className={`rounded-full px-2 py-1 ${item.revoked ? "bg-red-500/15 text-red-400" : item.expired ? "bg-yellow-500/15 text-yellow-400" : "bg-green-500/15 text-green-400"}`}
                      >
                        {statusLabel(item, {
                          revoked: t("revoked"),
                          expired: t("expired"),
                          active: t("active"),
                        })}
                      </span>
                      {item.has_password === 1 && (
                        <span className="rounded-full px-2 py-1 bg-white/5 text-gray-400">
                          🔒 {t("password")}
                        </span>
                      )}
                      {item.content_encryption === "e2ee-v1" && (
                        <span className="rounded-full px-2 py-1 bg-accent/15 text-accent-light">
                          🔐 E2EE
                        </span>
                      )}
                      <span className="rounded-full px-2 py-1 bg-white/5 text-gray-400">
                        {t("downloaded")}: {item.download_count}
                        {item.max_downloads ? ` / ${item.max_downloads}` : ""}
                      </span>
                    </div>
                  </div>
                  <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
                    <button
                      type="button"
                      onClick={() => copyLink(item)}
                      className="w-full rounded-lg bg-accent/20 px-3 py-2 text-sm text-accent-light hover:bg-accent/30 sm:w-auto"
                    >
                      {copied === item.token
                        ? t("copied")
                        : item.canRecreateLink
                          ? t("copy")
                          : t("noKey")}
                    </button>
                    <button
                      type="button"
                      onClick={() => showQr(item)}
                      className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-gray-300 hover:bg-white/10 sm:w-auto"
                    >
                      QR
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEdit({
                          token: item.token,
                          expiry: "keep",
                          password: "",
                          maxDownloads: item.max_downloads
                            ? String(item.max_downloads)
                            : "",
                          clearPassword: false,
                          clearLimit: false,
                        })
                      }
                      className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-gray-300 hover:bg-white/10 sm:w-auto"
                    >
                      {t("edit")}
                    </button>
                    {!item.revoked ? (
                      <button
                        type="button"
                        onClick={() => changeStatus(item, "revoke")}
                        className="w-full rounded-lg bg-yellow-500/10 px-3 py-2 text-sm text-yellow-400 hover:bg-yellow-500/20 sm:w-auto"
                      >
                        {t("revoke")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => changeStatus(item, "restore")}
                        className="w-full rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-400 hover:bg-green-500/20 sm:w-auto"
                      >
                        {t("restore")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteItem(item)}
                      className="w-full rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400 hover:bg-red-500/20 sm:w-auto"
                    >
                      {t("delete")}
                    </button>
                  </div>
                </div>
                {item.expires_at && (
                  <p className="text-xs text-gray-500 mt-3">
                    {t("expiresAt")}: {formatDate(item.expires_at, locale)}
                  </p>
                )}
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
        <nav
          aria-label={t("files")}
          className="mt-6 flex flex-col items-center justify-between gap-3 sm:flex-row"
        >
          <p className="text-sm text-gray-500">
            {t("shown", {
              from: (page - 1) * pageSize + 1,
              to: Math.min(page * pageSize, total),
              total,
            })}
          </p>
          <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5 sm:justify-end">
            <button
              type="button"
              aria-label={t("previousPage")}
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
              className="rounded-xl bg-white/5 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("back")}
            </button>
            <div className="flex items-center gap-1" aria-label={t("files")}>
              {getPaginationPages(totalPages, page).map((pageNumber, index) =>
                pageNumber === "ellipsis" ? (
                  <span
                    key={`ellipsis-${index}`}
                    aria-hidden="true"
                    className="px-1 text-gray-500"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={pageNumber}
                    type="button"
                    aria-label={`${pageNumber}`}
                    aria-current={pageNumber === page ? "page" : undefined}
                    onClick={() => setPage(pageNumber)}
                    className={`h-9 min-w-9 rounded-xl px-2 text-sm transition-colors ${pageNumber === page ? "bg-accent text-white" : "bg-white/5 text-gray-300 hover:bg-white/10"}`}
                  >
                    {pageNumber}
                  </button>
                ),
              )}
            </div>
            <button
              type="button"
              aria-label={t("nextPage")}
              disabled={page >= totalPages}
              onClick={() => setPage((value) => value + 1)}
              className="rounded-xl bg-white/5 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("forward")}
            </button>
          </div>
        </nav>
      )}

      {qr && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-3 py-4 sm:px-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setQr(null);
          }}
        >
          <div className="glass max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl p-4 text-center shadow-2xl sm:p-6">
            <h2 className="mb-4 text-xl font-semibold">{t("qrCode")}</h2>
            <div className="inline-block max-w-full rounded-xl bg-white p-3">
              <Image
                className="h-auto max-w-full"
                src={qr.dataUrl}
                alt={`${t("qrCode")}: ${qr.name}`}
                width={256}
                height={256}
                unoptimized
              />
            </div>
            <p className="mt-4 break-all text-sm text-gray-400">{qr.name}</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={copyQr}
                className="flex-1 rounded-xl bg-accent/20 py-2.5 text-sm font-medium text-accent-light hover:bg-accent/30"
              >
                {qrCopied ? t("qrCopied") : t("copyQr")}
              </button>
              <button
                type="button"
                onClick={() => setQr(null)}
                className="flex-1 rounded-xl bg-white/5 py-2.5 text-sm text-gray-300"
              >
                {t("close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
