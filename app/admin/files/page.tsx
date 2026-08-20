"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatFileSize } from "@/lib/utils";
import ThemedSelect from "@/components/ThemedSelect";

interface AdminFile {
  token: string;
  original_name: string;
  size: number;
  owner_email: string | null;
  group_token: string | null;
  group_revoked_at: string | null;
  expires_at: string | null;
  download_count: number;
  max_downloads: number | null;
  revoked_at: string | null;
  content_encryption: "none" | "e2ee-v1";
  deletion_attempts: number;
}

interface PaginationState {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type FileStatus = "active" | "revoked" | "expired";
const PAGE_SIZE = 20;

function Pagination({
  pagination,
  onPageChange,
}: {
  pagination: PaginationState;
  onPageChange: (page: number) => void;
}) {
  const t = useTranslations("adminPages");
  if (pagination.total <= pagination.limit) return null;
  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-white/10 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-gray-500">
        {t("pagination", {
          page: pagination.page,
          totalPages: pagination.totalPages,
          total: pagination.total,
        })}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPageChange(pagination.page - 1)}
          disabled={pagination.page <= 1}
          className="rounded-lg bg-white/5 px-3 py-2 text-gray-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← {t("back")}
        </button>
        <button
          type="button"
          onClick={() => onPageChange(pagination.page + 1)}
          disabled={pagination.page >= pagination.totalPages}
          className="rounded-lg bg-white/5 px-3 py-2 text-gray-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("forward")} →
        </button>
      </div>
    </div>
  );
}

function getFileStatus(file: AdminFile): FileStatus {
  if (file.revoked_at || file.group_revoked_at) return "revoked";
  if (file.expires_at && new Date(file.expires_at) <= new Date())
    return "expired";
  return "active";
}

export default function AdminFilesPage() {
  const t = useTranslations("adminPages");
  const [files, setFiles] = useState<AdminFile[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | FileStatus>("all");
  const [actionToken, setActionToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
    });
    if (query) params.set("q", query);
    if (status !== "all") params.set("status", status);
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/files?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(t("filesLoadError"));
      setFiles(data.files);
      setPagination({
        page: data.page,
        limit: data.limit,
        total: data.total,
        totalPages: data.totalPages,
      });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("filesLoadFailure"),
      );
    } finally {
      setLoading(false);
    }
  }, [page, query, status, t]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

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

  const updateFile = async (file: AdminFile, action: "revoke" | "restore") => {
    setActionToken(file.token);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/admin/files", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: file.token, action }),
      });
      if (!response.ok) throw new Error(t("fileUpdateError"));
      setSuccess(action === "revoke" ? t("linkRevoked") : t("linkRestored"));
      await loadFiles();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("fileUpdateError"));
    } finally {
      setActionToken(null);
    }
  };

  const deleteFile = async (file: AdminFile) => {
    if (!confirm(t("deleteConfirm", { name: file.original_name }))) return;
    setActionToken(file.token);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(
        `/api/admin/files?token=${encodeURIComponent(file.token)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(t("fileDeleteError"));
      setSuccess(t("fileDeleted"));
      await loadFiles();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("fileDeleteError"));
    } finally {
      setActionToken(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">{t("filesTitle")}</h2>
        <p className="text-gray-400 mt-1">{t("filesDescription")}</p>
      </div>

      {error && (
        <div className="glass rounded-xl p-4 border border-red-500/30 bg-red-500/10">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
      {success && (
        <div className="glass rounded-xl p-4 border border-green-500/30 bg-green-500/10">
          <p className="text-green-400 text-sm">{success}</p>
        </div>
      )}

      <div className="glass rounded-2xl p-4 sm:p-5">
        <form
          onSubmit={submitSearch}
          className="flex flex-col gap-2 lg:flex-row lg:items-center"
        >
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("searchFiles")}
            aria-label={t("searchFilesAria")}
            className="min-w-0 flex-1 bg-surface-overlay border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent/50"
          />
          <ThemedSelect
            value={status}
            options={[
              { value: "all", label: t("all") },
              { value: "active", label: t("active") },
              { value: "revoked", label: t("revoked") },
              { value: "expired", label: t("expired") },
            ]}
            onChange={(value) => {
              setStatus(value as typeof status);
              setPage(1);
            }}
            ariaLabel={t("filterFilesAria")}
            className="lg:w-44"
          />
          <button
            type="submit"
            className="px-3 py-2.5 rounded-lg bg-accent/20 text-accent-light text-sm hover:bg-accent/30"
          >
            {t("find")}
          </button>
          {(query || status !== "all") && (
            <button
              type="button"
              onClick={clearSearch}
              className="px-3 py-2.5 rounded-lg bg-white/5 text-gray-300 text-sm hover:bg-white/10"
            >
              {t("reset")}
            </button>
          )}
        </form>
      </div>

      <div className="glass rounded-2xl p-5">
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-500">
            {t("loading")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="pb-3 pr-4">{t("file")}</th>
                  <th className="pb-3 pr-4">{t("owner")}</th>
                  <th className="pb-3 pr-4">{t("size")}</th>
                  <th className="pb-3 pr-4">{t("downloads")}</th>
                  <th className="pb-3 pr-4">{t("status")}</th>
                  <th className="pb-3">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {files.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-8 text-center text-sm text-gray-500"
                    >
                      {t("noFiles")}
                    </td>
                  </tr>
                ) : (
                  files.map((file) => {
                    const fileStatus = getFileStatus(file);
                    const busy = actionToken === file.token;
                    return (
                      <tr
                        key={file.token}
                        className="border-t border-white/5 align-top"
                      >
                        <td
                          className="py-3 pr-4 max-w-[260px]"
                          title={file.original_name}
                        >
                          <p className="truncate">
                            {file.original_name}
                            {file.content_encryption === "e2ee-v1" && (
                              <span className="ml-2 text-xs text-accent-light">
                                E2EE
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-gray-600 mt-1 font-mono truncate">
                            {file.token}
                          </p>
                        </td>
                        <td className="py-3 pr-4 text-gray-400">
                          {file.owner_email || t("guest")}
                          {file.group_token && (
                            <p className="text-[11px] text-gray-600 mt-1">
                              {t("groupLink")}
                            </p>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-gray-400 whitespace-nowrap">
                          {formatFileSize(file.size)}
                        </td>
                        <td className="py-3 pr-4 text-gray-400 whitespace-nowrap">
                          {file.download_count}
                          {file.max_downloads ? ` / ${file.max_downloads}` : ""}
                        </td>
                        <td className="py-3 pr-4 whitespace-nowrap">
                          <span
                            className={
                              fileStatus === "active"
                                ? "text-green-400"
                                : fileStatus === "revoked"
                                  ? "text-red-400"
                                  : "text-amber-400"
                            }
                          >
                            {fileStatus === "active"
                              ? t("activeFile")
                              : fileStatus === "revoked"
                                ? t("revokedFile")
                                : t("expiredFile")}
                          </span>
                          {file.deletion_attempts > 0 && (
                            <p className="text-[11px] text-amber-400 mt-1">
                              {t("deletionErrors", {
                                count: file.deletion_attempts,
                              })}
                            </p>
                          )}
                        </td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-2 min-w-[190px]">
                            <Link
                              href={`/f/${file.token}`}
                              target="_blank"
                              className="px-2.5 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10"
                            >
                              {t("open")}
                            </Link>
                            {fileStatus === "revoked" ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void updateFile(file, "restore")}
                                className="px-2.5 py-1.5 rounded-lg text-xs bg-green-500/10 text-green-400 hover:bg-green-500/20 disabled:opacity-50"
                              >
                                {t("restore")}
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void updateFile(file, "revoke")}
                                className="px-2.5 py-1.5 rounded-lg text-xs bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
                              >
                                {t("revoke")}
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void deleteFile(file)}
                              className="px-2.5 py-1.5 rounded-lg text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                            >
                              {t("deleteFile")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagination={pagination} onPageChange={setPage} />
      </div>
    </div>
  );
}
