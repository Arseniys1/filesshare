"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
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
  hasPin: boolean;
  oneTime: boolean;
  used: boolean;
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
  hasPin: boolean;
  oneTime: boolean;
  used: boolean;
  createdAt: string;
  expired: boolean;
  revoked: boolean;
  downloadsExceeded: boolean;
  available: boolean;
  files: SharedFileInfo[];
}

type ShareInfo = SharedFile | SharedGroup;

function getDownloadError(response: Response, fallback: string): Promise<Error> {
  return response
    .json()
    .catch(() => ({}))
    .then((data: { error?: string }) => new Error(data.error || fallback));
}

export default function SharePage() {
  const params = useParams();
  const token = params.token as string;

  const [file, setFile] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);

  useEffect(() => {
    async function fetchFile() {
      try {
        const res = await fetch(`/api/files/${encodeURIComponent(token)}`);
        const data = await res.json();

        if (!res.ok) {
          setError(data.error);
          return;
        }

        setFile(data as ShareInfo);
      } catch {
        setError("Не удалось загрузить информацию о файле");
      } finally {
        setLoading(false);
      }
    }

    fetchFile();
  }, [token]);

  const authorizeAccess = async (): Promise<boolean> => {
    if (!file?.hasPassword && !file?.hasPin) return true;

    const res = await fetch(`/api/files/${encodeURIComponent(file.token)}/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, pin }),
    });
    if (res.ok) return true;

    const accessError = await getDownloadError(res, "Неверный пароль");
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
      throw new Error("В ссылке отсутствует ключ сквозного шифрования для этого файла");
    }
    if (target.contentEncryption !== "e2ee-v1") {
      window.location.assign(`/api/download/${encodeURIComponent(target.token)}`);
      return;
    }

    const response = await fetch(`/api/download/${encodeURIComponent(target.token)}`);
    if (!response.ok) {
      throw await getDownloadError(response, "Не удалось получить файл");
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
        throw new Error(`В ссылке отсутствует ключ для файла «${target.name}»`);
      }
      keys[target.token] = rawKey;
    }

    for (const target of group.files) {
      const response = await fetch(`/api/download/${encodeURIComponent(target.token)}`);
      if (!response.ok) {
        throw await getDownloadError(response, `Не удалось получить файл «${target.name}»`);
      }

      let blob: Blob;
      if (target.contentEncryption === "e2ee-v1") {
        if (!response.body) throw new Error("Сервер не вернул содержимое файла");
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
          : "Ошибка при скачивании"
      );
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-32 text-center">
        <div className="w-12 h-12 mx-auto border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        <p className="mt-4 text-gray-400">Загрузка...</p>
      </div>
    );
  }

  if (error && !file) {
    return (
      <div className="max-w-lg mx-auto px-4 py-32 text-center animate-fade-in">
        <div className="text-6xl mb-4">😔</div>
        <h1 className="text-2xl font-bold mb-2">Файл недоступен</h1>
        <p className="text-gray-400">{error}</p>
      </div>
    );
  }

  if (!file) return null;

  const unavailable = file.expired || file.revoked || file.downloadsExceeded || file.used;
  const isGroup = file.kind === "group";
  const e2eeFiles = isGroup
    ? file.files.filter((item) => item.contentEncryption === "e2ee-v1").length
    : file.contentEncryption === "e2ee-v1"
      ? 1
      : 0;

  return (
    <div className={`mx-auto px-4 py-16 animate-fade-in ${isGroup ? "max-w-3xl" : "max-w-lg"}`}>
      <div className="glass rounded-2xl p-8 gradient-border">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">{isGroup ? "📦" : getFileIcon(file.mimeType)}</div>
          <h1 className="text-xl font-bold mb-1 break-all">{file.name}</h1>
          <p className="text-gray-400 text-sm">
            {isGroup
              ? `${file.files.length} файлов · ${formatFileSize(file.size)}`
              : formatFileSize(file.size)}
          </p>
        </div>

        <div className="space-y-3 mb-8">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Загружен</span>
            <span>{formatDate(file.createdAt)}</span>
          </div>
          {file.expiresAt && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Действует до</span>
              <span className={file.expired ? "text-red-400" : ""}>
                {formatDate(file.expiresAt)}
              </span>
            </div>
          )}
          {file.maxDownloads && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">
                {isGroup ? "Скачивания файлов" : "Скачивания"}
              </span>
              <span>
                {file.downloadCount} / {file.maxDownloads}
              </span>
            </div>
          )}
          {file.hasPassword && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Защита</span>
              <span>🔒 Пароль</span>
            </div>
          )}
          {file.hasPin && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Доступ</span>
              <span>🔢 PIN-код</span>
            </div>
          )}
          {file.oneTime && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Режим</span>
              <span>Одноразовая ссылка</span>
            </div>
          )}
          {e2eeFiles > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Шифрование</span>
              <span>🔐 Сквозное{isGroup ? ` · ${e2eeFiles} файла` : ""}</span>
            </div>
          )}
          {!isGroup && file.storageEncrypted && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Хранение</span>
              <span>🛡️ Зашифровано</span>
            </div>
          )}
        </div>

        {unavailable ? (
          <div className="text-center py-4">
            <p className="text-red-400 font-medium">
              {file.revoked
                ? "Ссылка отозвана"
                : file.used
                ? "Одноразовая ссылка уже использована"
                : file.expired
                ? "Срок действия ссылки истёк"
                : "Достигнут лимит скачиваний"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {(file.hasPassword || needsPassword) && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Введите пароль"
                className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50 transition-colors placeholder:text-gray-600"
              />
            )}
            {file.hasPin && (
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Введите PIN-код"
                className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50 transition-colors placeholder:text-gray-600"
              />
            )}

            {error && <p className="text-red-400 text-sm text-center">{error}</p>}

            {isGroup ? (
              <>
                <div className="rounded-2xl border border-white/10 bg-surface-overlay/50 p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h2 className="font-medium">Файлы в ссылке</h2>
                    <span className="text-xs text-gray-500">{file.files.length} шт.</span>
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
                            {item.storageEncrypted && " · хранилище защищено"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDownload(item)}
                          disabled={downloading}
                          className="flex-shrink-0 rounded-lg bg-accent/15 px-3 py-2 text-sm font-medium text-accent-light transition-colors hover:bg-accent/25 disabled:opacity-50"
                        >
                          Скачать
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
                  {downloading ? "Подготовка архива..." : "Скачать всё"}
                </button>
                <p className="text-center text-xs text-gray-500">
                  Архив создаётся в браузере после скачивания файлов.
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
                  ? "Расшифровка..."
                  : file.contentEncryption === "e2ee-v1"
                    ? "Расшифровать и скачать"
                    : "Скачать файл"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
