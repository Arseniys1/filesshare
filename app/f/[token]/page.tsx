"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatFileSize, formatDate, getFileIcon } from "@/lib/utils";

interface FileInfo {
  token: string;
  name: string;
  size: number;
  mimeType: string;
  expiresAt: string | null;
  downloadCount: number;
  maxDownloads: number | null;
  hasPassword: boolean;
  createdAt: string;
  expired: boolean;
  downloadsExceeded: boolean;
  available: boolean;
}

export default function SharePage() {
  const params = useParams();
  const token = params.token as string;

  const [file, setFile] = useState<FileInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);

  useEffect(() => {
    async function fetchFile() {
      try {
        const res = await fetch(`/api/files/${token}`);
        const data = await res.json();

        if (!res.ok) {
          setError(data.error);
          return;
        }

        setFile(data);
      } catch {
        setError("Не удалось загрузить информацию о файле");
      } finally {
        setLoading(false);
      }
    }

    fetchFile();
  }, [token]);

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    let downloadStarted = false;

    try {
      if (file?.hasPassword) {
        const res = await fetch(`/api/files/${token}/access`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setNeedsPassword(true);
          setError(data.error || "Неверный пароль");
          return;
        }
      }

      window.location.assign(`/api/download/${encodeURIComponent(token)}`);
      downloadStarted = true;
      window.setTimeout(() => setDownloading(false), 1000);
    } catch {
      setError("Ошибка при скачивании");
    } finally {
      if (!downloadStarted) setDownloading(false);
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

  const unavailable = file.expired || file.downloadsExceeded;

  return (
    <div className="max-w-lg mx-auto px-4 py-16 animate-fade-in">
      <div className="glass rounded-2xl p-8 gradient-border">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">{getFileIcon(file.mimeType)}</div>
          <h1 className="text-xl font-bold mb-1 break-all">{file.name}</h1>
          <p className="text-gray-400 text-sm">{formatFileSize(file.size)}</p>
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
              <span className="text-gray-400">Скачивания</span>
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
        </div>

        {unavailable ? (
          <div className="text-center py-4">
            <p className="text-red-400 font-medium">
              {file.expired
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

            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}

            <button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 animate-pulse-glow"
            >
              {downloading ? "Скачивание..." : "Скачать файл"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
