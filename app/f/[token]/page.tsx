"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  decryptE2EEToBlob,
  downloadE2EEFile,
  readE2EEKeyFromHash,
  readE2EEKeysFromHash,
} from "@/lib/e2ee-client";
import { createZipBlob, triggerBlobDownload } from "@/lib/archive-client";
import { formatFileSize, formatDate, getFileIcon } from "@/lib/utils";

interface SharedFileInfo {
  token: string;
  name: string;
  size: number;
  mimeType: string;
  storageEncrypted: boolean;
  contentEncryption: "none" | "e2ee-v1";
}

interface SharedFile extends SharedFileInfo {
  expiresAt: string | null;
  downloadCount: number;
  maxDownloads: number | null;
  hasPassword: boolean;
  createdAt: string;
  expired: boolean;
  revoked: boolean;
  downloadsExceeded: boolean;
  available: boolean;
  kind: "file";
}

interface SharedGroup {
  kind: "group";
  token: string;
  name: string;
  size: number;
  expiresAt: string | null;
  downloadCount: number;
  maxDownloads: number | null;
  hasPassword: boolean;
  createdAt: string;
  expired: boolean;
  revoked: boolean;
  downloadsExceeded: boolean;
  available: boolean;
  files: SharedFileInfo[];
}

type ShareInfo = SharedFile | SharedGroup;

function getDownloadError(response: Response, fallback: string): Promise<Error> {
  void response;
  return Promise.resolve(new Error(fallback));
}

export default function SharePage() {
  const t = useTranslations("share");
  const locale = useLocale();
  const params = useParams();
  const token = params.token as string;

  const [file, setFile] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);

  useEffect(() => {
    async function fetchFile() {
      try {
        const res = await fetch(`/api/files/${encodeURIComponent(token)}`);
        const data = await res.json();

        if (!res.ok) {
          setError(t("loadError"));
          return;
        }

        setFile(data as ShareInfo);
      } catch {
        setError(t("loadError"));
      } finally {
        setLoading(false);
      }
    }

    fetchFile();
  }, [t, token]);

  const authorizeAccess = async (): Promise<boolean> => {
    if (!file?.hasPassword) return true;

    const res = await fetch(`/api/files/${encodeURIComponent(file.token)}/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) return true;

    const accessError = await getDownloadError(res, t("wrongPassword"));
    setNeedsPassword(true);
    setError(accessError.message);
    return false;
  };

  const getE2EEKey = (target: SharedFileInfo): Uint8Array | null => {
    if (target.contentEncryption !== "e2ee-v1") return null;

    if (file?.kind === "group") {
      const keys = readE2EEKeysFromHash(window.location.hash);
      return keys[target.token] || null;
    }

    return readE2EEKeyFromHash(window.location.hash);
  };

  const downloadOne = async (target: SharedFileInfo): Promise<void> => {
    const rawKey = getE2EEKey(target);
    if (target.contentEncryption === "e2ee-v1" && !rawKey) {
      throw new Error(t("missingE2eeKey"));
    }
    if (target.contentEncryption !== "e2ee-v1") {
      window.location.assign(`/api/download/${encodeURIComponent(target.token)}`);
      return;
    }

    const response = await fetch(`/api/download/${encodeURIComponent(target.token)}`);
    if (!response.ok) {
      throw await getDownloadError(response, t("downloadError"));
    }

    await downloadE2EEFile({
      response,
      rawKey: rawKey!,
      fileName: target.name,
      mimeType: target.mimeType,
      size: target.size,
    });
  };

  const downloadGroupArchive = async (group: SharedGroup): Promise<void> => {
    const entries: Array<{ name: string; blob: Blob }> = [];
    const keys: Record<string, Uint8Array> = {};

    for (const target of group.files) {
      if (target.contentEncryption !== "e2ee-v1") continue;
      const rawKey = getE2EEKey(target);
      if (!rawKey) {
        throw new Error(t("missingFileKey", { name: target.name }));
      }
      keys[target.token] = rawKey;
    }

    for (const target of group.files) {
      const response = await fetch(`/api/download/${encodeURIComponent(target.token)}`);
      if (!response.ok) {
        throw await getDownloadError(response, `${t("downloadError")} «${target.name}»`);
      }

      let blob: Blob;
      if (target.contentEncryption === "e2ee-v1") {
        if (!response.body) throw new Error(t("serverNoContent"));
        blob = await decryptE2EEToBlob(
          response.body,
          keys[target.token],
          target.size,
          target.mimeType
        );
      } else {
        blob = new Blob([await response.arrayBuffer()], {
          type: target.mimeType || "application/octet-stream",
        });
      }
      entries.push({ name: target.name, blob });
    }

    const archive = await createZipBlob(entries);
    triggerBlobDownload(archive, `fileshare-${group.token}.zip`);
  };

  const handleDownload = async (target?: SharedFileInfo) => {
    if (!file) return;
    setDownloading(true);
    setError(null);

    try {
      if (!(await authorizeAccess())) return;

      if (file.kind === "group") {
        if (target) await downloadOne(target);
        else await downloadGroupArchive(file);
      } else {
        await downloadOne(file);
      }
    } catch (downloadError) {
      if (downloadError instanceof DOMException && downloadError.name === "AbortError") {
        return;
      }
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : t("downloadFailed")
      );
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-32 text-center">
        <div className="w-12 h-12 mx-auto border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        <p className="mt-4 text-gray-400">{t("loading")}</p>
      </div>
    );
  }

  if (error && !file) {
    return (
      <div className="max-w-lg mx-auto px-4 py-32 text-center animate-fade-in">
        <div className="text-6xl mb-4">😔</div>
        <h1 className="text-2xl font-bold mb-2">{t("unavailable")}</h1>
        <p className="text-gray-400">{error}</p>
      </div>
    );
  }

  if (!file) return null;

  const unavailable = file.expired || file.revoked || file.downloadsExceeded;
  const isGroup = file.kind === "group";
  const e2eeFiles = isGroup
    ? file.files.filter((item) => item.contentEncryption === "e2ee-v1").length
    : file.contentEncryption === "e2ee-v1"
      ? 1
      : 0;

  return (
    <div className={`mx-auto px-3 py-10 animate-fade-in sm:px-4 sm:py-16 ${isGroup ? "max-w-3xl" : "max-w-lg"}`}>
      <div className="glass rounded-2xl p-5 gradient-border sm:p-8">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">{isGroup ? "📦" : getFileIcon(file.mimeType)}</div>
          <h1 className="text-xl font-bold mb-1 break-all">{file.name}</h1>
          <p className="text-gray-400 text-sm">
            {isGroup
              ? t("filesCount", { count: file.files.length, size: formatFileSize(file.size) })
              : formatFileSize(file.size)}
          </p>
        </div>

        <div className="space-y-3 mb-8">
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
            <span className="text-gray-400">{t("uploaded")}</span>
            <span>{formatDate(file.createdAt, locale)}</span>
          </div>
          {file.expiresAt && (
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
              <span className="text-gray-400">{t("expires")}</span>
              <span className={file.expired ? "text-red-400" : ""}>
                {formatDate(file.expiresAt, locale)}
              </span>
            </div>
          )}
          {file.maxDownloads && (
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
              <span className="text-gray-400">
                {isGroup ? t("fileDownloads") : t("downloads")}
              </span>
              <span>
                {file.downloadCount} / {file.maxDownloads}
              </span>
            </div>
          )}
          {file.hasPassword && (
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
              <span className="text-gray-400">{t("protection")}</span>
              <span>🔒 {t("passwordProtected")}</span>
            </div>
          )}
          {e2eeFiles > 0 && (
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
              <span className="text-gray-400">{t("encryption")}</span>
              <span>🔐 {t("endToEndShort")}{isGroup ? ` · ${e2eeFiles}` : ""}</span>
            </div>
          )}
          {!isGroup && file.storageEncrypted && (
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
              <span className="text-gray-400">{t("storage")}</span>
              <span>🛡️ {t("encrypted")}</span>
            </div>
          )}
        </div>

        {unavailable ? (
          <div className="text-center py-4">
            <p className="text-red-400 font-medium">
              {file.revoked
                ? t("revoked")
                : file.expired
                ? t("expired")
                : t("downloadsExceeded")}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {(file.hasPassword || needsPassword) && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("enterPassword")}
                className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50 transition-colors placeholder:text-gray-600"
              />
            )}
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}

            {isGroup ? (
              <>
                <div className="rounded-2xl border border-white/10 bg-surface-overlay/50 p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h2 className="font-medium">{t("filesInLink")}</h2>
                    <span className="text-xs text-gray-500">{t("items", { count: file.files.length })}</span>
                  </div>
                  <div className="space-y-2">
                    {file.files.map((item) => (
                      <div
                        key={item.token}
                        className="flex items-center gap-3 rounded-xl border border-white/5 bg-surface/40 px-3 py-3"
                      >
                        <span className="text-2xl flex-shrink-0">{getFileIcon(item.mimeType)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium" title={item.name}>{item.name}</p>
                          <p className="text-xs text-gray-500">
                            {formatFileSize(item.size)}
                            {item.contentEncryption === "e2ee-v1" && " · E2EE"}
                            {item.storageEncrypted && ` · ${t("storage")} ${t("encrypted").toLowerCase()}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDownload(item)}
                          disabled={downloading}
                          className="flex-shrink-0 rounded-lg bg-accent/15 px-3 py-2 text-sm font-medium text-accent-light transition-colors hover:bg-accent/25 disabled:opacity-50"
                        >
                          {t("download")}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleDownload()}
                  disabled={downloading}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 animate-pulse-glow"
                >
                  {downloading ? t("preparingArchive") : t("downloadAll")}
                </button>
                <p className="text-center text-xs text-gray-500">
                  {t("archiveNote")}
                </p>
              </>
            ) : (
              <button
                type="button"
                onClick={() => handleDownload()}
                disabled={downloading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 animate-pulse-glow"
              >
                {downloading
                  ? t("decrypting")
                  : file.contentEncryption === "e2ee-v1"
                    ? t("decryptAndDownload")
                    : t("downloadFile")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
