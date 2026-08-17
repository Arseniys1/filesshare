"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  addE2EEKeysToShareUrl,
  addE2EEKeyToShareUrl,
} from "@/lib/e2ee-client";
import { uploadE2EEFileResumable, uploadFileResumable } from "@/lib/resumable-upload-client";
import { EXPIRY_OPTIONS, formatFileSize } from "@/lib/utils";

interface UploadedFile {
  token: string;
  name: string;
  size: number;
  mimeType: string;
  shareUrl: string;
  expiresAt: string | null;
  hasPassword: boolean;
  storageEncrypted: boolean;
  contentEncryption: "none" | "e2ee-v1";
  e2eeKey?: string;
  fileCount?: number;
  isGroup?: boolean;
}

interface FileGroupUpload {
  token: string;
  shareUrl: string;
  expiresAt: string | null;
  maxDownloads: number | null;
  hasPassword: boolean;
}

interface QueueItem {
  id: string;
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
  result?: UploadedFile;
}

interface UploadZoneProps {
  maxFileSize: number;
  maxFileSizeLabel: string;
}

type LinkMode = "group" | "individual";

export default function UploadZone({
  maxFileSize,
  maxFileSizeLabel,
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [transferProgress, setTransferProgress] = useState({ uploaded: 0, total: 0, parts: 0, totalParts: 0, speed: 0, remaining: 0 });
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [expiry, setExpiry] = useState("never");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [maxDownloads, setMaxDownloads] = useState("");
  const [maxRecipients, setMaxRecipients] = useState("");
  const [oneTime, setOneTime] = useState(false);
  const [linkMode, setLinkMode] = useState<LinkMode>("group");
  const [endToEndEncryption, setEndToEndEncryption] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const expiryMenuRef = useRef<HTMLDetailsElement>(null);
  const pausedRef = useRef(false);
  const resumeResolversRef = useRef<Array<() => void>>([]);
  const progressStartedRef = useRef<{ uploaded: number; at: number } | null>(null);

  const waitForResume = useCallback(async () => {
    if (!pausedRef.current) return;
    await new Promise<void>((resolve) => resumeResolversRef.current.push(resolve));
  }, []);

  const setTransferProgressFromUpload = useCallback((uploaded: number, total: number, parts = 0, totalParts = 0) => {
    const now = Date.now();
    const previous = progressStartedRef.current;
    const elapsed = previous ? Math.max(0.001, (now - previous.at) / 1000) : 0;
    const speed = previous ? Math.max(0, (uploaded - previous.uploaded) / elapsed) : 0;
    progressStartedRef.current = { uploaded, at: now };
    setTransferProgress((current) => ({
      uploaded,
      total,
      parts,
      totalParts,
      speed: speed || current.speed,
      remaining: speed > 0 ? Math.max(0, (total - uploaded) / speed) : current.remaining,
    }));
  }, []);

  const uploadProgressOptions = useCallback(() => ({
    waitForResume,
    onProgress: setTransferProgressFromUpload,
  }), [setTransferProgressFromUpload, waitForResume]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const menu = expiryMenuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const createGroup = useCallback(async (): Promise<FileGroupUpload> => {
    const response = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expiry,
        ...(password ? { password } : {}),
        ...(pin ? { pin } : {}),
        ...(oneTime ? { oneTime } : {}),
        ...(maxDownloads ? { maxDownloads } : {}),
        ...(maxRecipients ? { maxRecipients } : {}),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось создать группу файлов");
    return data.group;
  }, [expiry, maxDownloads, maxRecipients, oneTime, password, pin]);

  const uploadSingle = useCallback(async (file: File, groupToken?: string): Promise<UploadedFile> => {
    if (endToEndEncryption) {
      const result = await uploadE2EEFileResumable(file, {
        expiry,
        ...uploadProgressOptions(),
        ...(password ? { password } : {}),
        ...(pin ? { pin } : {}),
        oneTime,
        ...(maxDownloads ? { maxDownloads } : {}),
        ...(maxRecipients ? { maxRecipients } : {}),
        ...(groupToken ? { groupToken } : {}),
      });
      return {
        ...(result.file as unknown as UploadedFile),
        shareUrl: addE2EEKeyToShareUrl(result.file.shareUrl, result.key),
        e2eeKey: result.key,
      };
    }

    if (file.size > 4 * 1024 * 1024) {
      return await uploadFileResumable(file, {
        expiry,
        ...uploadProgressOptions(),
        ...(groupToken ? { groupToken } : {}),
        ...(password ? { password } : {}),
        ...(pin ? { pin } : {}),
        ...(oneTime ? { oneTime } : {}),
        ...(maxDownloads ? { maxDownloads } : {}),
        ...(maxRecipients ? { maxRecipients } : {}),
      }) as UploadedFile;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("expiry", expiry);
    if (groupToken) formData.append("groupToken", groupToken);
    if (password) formData.append("password", password);
    if (pin) formData.append("pin", pin);
    if (oneTime) formData.append("oneTime", "true");
    if (maxDownloads) formData.append("maxDownloads", maxDownloads);
    if (maxRecipients) formData.append("maxRecipients", maxRecipients);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Ошибка загрузки");
    }
    return data.file;
  }, [endToEndEncryption, expiry, maxDownloads, maxRecipients, oneTime, password, pin, uploadProgressOptions]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const tooLarge = files.filter((f) => f.size > maxFileSize);
      if (tooLarge.length > 0) {
        setGlobalError(
          tooLarge.length === 1
            ? `${tooLarge[0].name}: превышает лимит ${maxFileSizeLabel}`
            : `${tooLarge.length} файлов превышают лимит ${maxFileSizeLabel}:\n${tooLarge.map((f) => f.name).join("\n")}`
        );
        return;
      }

      setUploading(true);
      pausedRef.current = false;
      setPaused(false);
      setTransferProgress({ uploaded: 0, total: 0, parts: 0, totalParts: 0, speed: 0, remaining: 0 });
      progressStartedRef.current = null;
      resumeResolversRef.current = [];
      setGlobalError(null);

      const items: QueueItem[] = files.map((file, i) => ({
        id: `${Date.now()}-${i}`,
        file,
        status: "pending" as const,
      }));
      setQueue(items);

      const results: UploadedFile[] = [];
      const errors: string[] = [];
      let group: FileGroupUpload | null = null;
      const shouldCreateGroup = files.length > 1 && linkMode === "group";

      if (shouldCreateGroup) {
        try {
          group = await createGroup();
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Ошибка создания группы файлов";
          errors.push(`Группа файлов: ${msg}`);
          setQueue((prev) => prev.map((q) => ({ ...q, status: "error", error: msg })));
        }
      }

      for (let i = 0; i < items.length && (!shouldCreateGroup || group !== null); i++) {
        const item = items[i];

        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: "uploading" } : q
          )
        );

        try {
          const result = await uploadSingle(item.file, group?.token);
          results.push(result);

          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id ? { ...q, status: "done", result } : q
            )
          );
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : "Ошибка загрузки";
          errors.push(`${item.file.name}: ${msg}`);

          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id ? { ...q, status: "error", error: msg } : q
            )
          );
        }
      }

      if (shouldCreateGroup && group && results.length > 0) {
        const e2eeKeys = Object.fromEntries(
          results
            .filter((result) => result.e2eeKey)
            .map((result) => [result.token, result.e2eeKey!])
        );
        const shareUrl = Object.keys(e2eeKeys).length > 0
          ? addE2EEKeysToShareUrl(group.shareUrl, e2eeKeys)
          : group.shareUrl;
        const groupResult: UploadedFile = {
          token: group.token,
          name: `Пакет из ${results.length} файлов`,
          size: results.reduce((total, result) => total + result.size, 0),
          mimeType: "application/octet-stream",
          shareUrl,
          expiresAt: group.expiresAt,
          hasPassword: group.hasPassword,
          storageEncrypted: results.every((result) => result.storageEncrypted),
          contentEncryption: results.every((result) => result.contentEncryption === "e2ee-v1")
            ? "e2ee-v1"
            : "none",
          fileCount: results.length,
          isGroup: true,
        };
        setUploadedFiles((prev) => [groupResult, ...prev]);
      } else if (results.length > 0) {
        setUploadedFiles((prev) => [...results, ...prev]);
      }
      if (errors.length > 0) {
        setGlobalError(
          shouldCreateGroup && !group
            ? errors.join("\n")
            : errors.length === items.length
              ? errors.join("\n")
              : `Не загружено ${errors.length} из ${items.length}:\n${errors.join("\n")}`
        );
      }

      setUploading(false);
      pausedRef.current = false;
      setPaused(false);
      const resolvers = resumeResolversRef.current.splice(0);
      resolvers.forEach((resolve) => resolve());
    },
    [createGroup, linkMode, maxFileSize, maxFileSizeLabel, uploadSingle]
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      uploadFiles(Array.from(files));
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [uploadFiles]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const pauseUpload = () => {
    pausedRef.current = true;
    setPaused(true);
  };

  const resumeUpload = () => {
    pausedRef.current = false;
    setPaused(false);
    const resolvers = resumeResolversRef.current.splice(0);
    resolvers.forEach((resolve) => resolve());
  };

  const copyLink = async (url: string, token: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const copyAllLinks = async () => {
    const links = uploadedFiles.map((f) => f.shareUrl).join("\n");
    await navigator.clipboard.writeText(links);
    setCopiedToken("all");
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const doneCount = queue.filter((q) => q.status === "done").length;
  const totalCount = queue.length;
  const progress =
    totalCount > 0
      ? Math.round(
          ((doneCount + queue.filter((q) => q.status === "error").length) /
            totalCount) *
            100
        )
      : 0;

  return (
    <div className="space-y-8">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`
          relative cursor-pointer rounded-2xl p-12 text-center transition-all duration-300
          gradient-border glass glass-hover
          ${isDragging ? "scale-[1.02] border-accent/50" : ""}
          ${uploading ? "pointer-events-none opacity-70" : ""}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        <div className="animate-float">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-accent/20 to-purple-500/20 flex items-center justify-center">
            <svg
              className="w-10 h-10 text-accent-light"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>
        </div>

        {uploading ? (
          <div className="space-y-3">
            <p className="text-lg font-medium">
              {totalCount > 1 && linkMode === "group"
                ? "Загрузка группы файлов..."
                : `Загрузка ${doneCount + 1} из ${totalCount}...`}
            </p>
            <div className="w-64 mx-auto h-2 bg-surface-overlay rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent to-purple-500 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-gray-400">{progress}%</p>
          </div>
        ) : (
          <>
            <p className="text-xl font-medium mb-2">
              Перетащите файлы сюда или{" "}
              <span className="gradient-text">выберите</span>
            </p>
            <p className="text-gray-400 text-sm">
              Можно загрузить несколько файлов · до {maxFileSizeLabel} каждый
            </p>
          </>
        )}
      </div>

      {uploading && transferProgress.total > 0 && (
        <div className="glass rounded-2xl px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-2"><span>{paused ? "Загрузка приостановлена" : "Текущий файл"}</span><span>{Math.round((transferProgress.uploaded / transferProgress.total) * 100)}%</span></div>
            <div className="h-2 bg-surface-overlay rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-accent to-purple-500 transition-all" style={{ width: `${Math.min(100, (transferProgress.uploaded / transferProgress.total) * 100)}%` }} /></div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-2"><span>{formatFileSize(transferProgress.uploaded)} / {formatFileSize(transferProgress.total)}</span>{transferProgress.totalParts > 0 && <span>Части: {transferProgress.parts} / {transferProgress.totalParts}</span>}{transferProgress.speed > 0 && <span>{formatFileSize(transferProgress.speed)} / с</span>}{transferProgress.remaining > 0 && <span>Осталось: {Math.ceil(transferProgress.remaining)} с</span>}</div>
          </div>
          <button type="button" onClick={paused ? resumeUpload : pauseUpload} className="self-start sm:self-auto px-4 py-2.5 rounded-xl bg-white/5 text-gray-300 text-sm hover:bg-white/10">{paused ? "Продолжить" : "Пауза"}</button>
        </div>
      )}

      <div className="glass relative z-40 rounded-2xl p-6 space-y-4">
        <h3 className="font-medium text-gray-300">Настройки доступа</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              Срок действия
            </label>
            <details ref={expiryMenuRef} className="group relative z-50">
              <summary
                role="button"
                aria-label="Срок действия ссылки"
                aria-controls="expiry-options"
                aria-haspopup="listbox"
                onClick={(event) => {
                  if (uploading) event.preventDefault();
                }}
                className="flex w-full cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-white/10 bg-surface-overlay px-4 py-2.5 text-left text-sm transition-all hover:border-accent/35 hover:bg-accent/[0.03] focus:outline-none focus:ring-4 focus:ring-accent/15 group-open:border-accent/60 group-open:bg-accent/[0.06] [&::-webkit-details-marker]:hidden"
              >
                <span>{EXPIRY_OPTIONS.find((option) => option.value === expiry)?.label}</span>
                <svg
                  className="h-4 w-4 flex-shrink-0 text-gray-400 transition-transform duration-200 group-open:rotate-180 group-open:text-accent-light"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </summary>
              <div
                id="expiry-options"
                role="listbox"
                aria-label="Срок действия ссылки"
                className="absolute left-0 top-full z-40 mt-2 w-60 max-w-[calc(100vw-2rem)] min-w-full overflow-hidden rounded-2xl border border-white/10 bg-surface-overlay p-2 shadow-2xl shadow-black/20 backdrop-blur-xl animate-fade-in"
              >
                <div className="space-y-1">
                  {EXPIRY_OPTIONS.map((option) => {
                    const selected = expiry === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setExpiry(option.value);
                          if (expiryMenuRef.current) expiryMenuRef.current.open = false;
                        }}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                          selected
                            ? "bg-accent/15 text-accent-light"
                            : "text-gray-400 hover:bg-white/5 hover:text-gray-300"
                        }`}
                      >
                        <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${selected ? "bg-accent/15" : "bg-white/5"}`}>
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
                            <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                        <span className="flex-1">{option.label}</span>
                        {selected && (
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </details>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              Пароль (необязательно)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Защитить паролем"
              disabled={uploading}
              className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50 transition-colors placeholder:text-gray-600 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              Лимит скачиваний
            </label>
            <input
              type="number"
              value={maxDownloads}
              onChange={(e) => setMaxDownloads(e.target.value)}
              placeholder="Без ограничения"
              min="1"
              disabled={uploading}
              className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50 transition-colors placeholder:text-gray-600 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Лимит получателей</label>
            <input
              type="number"
              value={maxRecipients}
              onChange={(e) => setMaxRecipients(e.target.value)}
              placeholder="Без ограничения"
              min="1"
              disabled={uploading}
              className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50 transition-colors placeholder:text-gray-600 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">PIN-код</label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Необязательно"
              disabled={uploading}
              className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50 transition-colors placeholder:text-gray-600 disabled:opacity-50"
            />
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm text-gray-400 cursor-pointer">
          <input type="checkbox" checked={oneTime} onChange={(e) => setOneTime(e.target.checked)} disabled={uploading} className="h-4 w-4 accent-accent" />
          Одноразовая ссылка — доступ только для одного скачивания
        </label>
        <div>
          <span className="block text-sm text-gray-400 mb-1.5">Ссылки на файлы</span>
          <div
            role="radiogroup"
            aria-label="Способ создания ссылок"
            className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-surface-overlay p-1.5"
          >
            <button
              type="button"
              role="radio"
              aria-checked={linkMode === "group"}
              disabled={uploading}
              onClick={() => setLinkMode("group")}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                linkMode === "group"
                  ? "bg-accent/15 text-accent-light shadow-sm"
                  : "text-gray-400 hover:bg-white/5 hover:text-gray-300"
              }`}
            >
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/5">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M7 7h10M7 12h10M7 17h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <rect x="3.5" y="3.5" width="17" height="17" rx="4" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Одна общая ссылка</span>
                <span className="mt-0.5 block text-xs opacity-70">Список файлов и «Скачать всё»</span>
              </span>
              {linkMode === "group" && (
                <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={linkMode === "individual"}
              disabled={uploading}
              onClick={() => setLinkMode("individual")}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                linkMode === "individual"
                  ? "bg-accent/15 text-accent-light shadow-sm"
                  : "text-gray-400 hover:bg-white/5 hover:text-gray-300"
              }`}
            >
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/5">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M8.5 15.5 15.5 8.5M6.5 18.5H5a2.5 2.5 0 0 1-2.5-2.5v-9A2.5 2.5 0 0 1 5 4.5h9A2.5 2.5 0 0 1 16.5 7v1.5M9.5 19.5h9a2.5 2.5 0 0 0 2.5-2.5V8a2.5 2.5 0 0 0-2.5-2.5h-1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Отдельная ссылка</span>
                <span className="mt-0.5 block text-xs opacity-70">Своя ссылка для каждого файла</span>
              </span>
              {linkMode === "individual" && (
                <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
        </div>
        <label
          className={`flex w-full items-center gap-4 rounded-2xl border px-4 py-3.5 cursor-pointer transition-all ${
            endToEndEncryption
              ? "border-accent/40 bg-accent/10 shadow-[0_8px_24px_rgba(84,156,255,0.08)]"
              : "border-white/10 bg-surface-overlay hover:border-accent/30 hover:bg-accent/[0.04]"
          }`}
        >
          <input
            type="checkbox"
            checked={endToEndEncryption}
            onChange={(e) => setEndToEndEncryption(e.target.checked)}
            disabled={uploading}
            className="h-5 w-5 flex-shrink-0 accent-accent"
          />
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-light">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M12 3l7 3v5c0 4.6-2.9 7.9-7 10-4.1-2.1-7-5.4-7-10V6l7-3z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M9.5 12l1.7 1.7 3.5-3.5"
              />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
              Сквозное шифрование
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent-light">
                E2EE
              </span>
            </span>
            <span className="mt-1 block text-xs text-gray-400">
              Ключ будет только в ссылке. Потеря ссылки означает потерю доступа.
            </span>
          </span>
          <span className={`hidden text-xs sm:block ${endToEndEncryption ? "text-accent-light" : "text-gray-500"}`}>
            {endToEndEncryption ? "Включено" : "Выключено"}
          </span>
        </label>
      </div>

      {queue.length > 0 && (
        <div className="space-y-2 animate-slide-up">
          <h3 className="font-medium text-gray-300">Очередь загрузки</h3>
          {queue.map((item) => (
            <div
              key={item.id}
              className="glass rounded-xl px-4 py-3 flex items-center gap-3"
            >
              <span className="text-lg flex-shrink-0">
                {item.status === "done" && "✅"}
                {item.status === "error" && "❌"}
                {item.status === "uploading" && (
                  <span className="inline-block w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                )}
                {item.status === "pending" && "⏳"}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.file.name}</p>
                <p className="text-xs text-gray-400">
                  {formatFileSize(item.file.size)}
                  {item.error && (
                    <span className="text-red-400"> · {item.error}</span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {globalError && (
        <div className="glass rounded-xl p-4 border border-red-500/30 bg-red-500/10 animate-slide-up">
          <p className="text-red-400 text-sm whitespace-pre-line">{globalError}</p>
        </div>
      )}

      {uploadedFiles.length > 0 && (
        <div className="space-y-3 animate-slide-up">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-gray-300">
              Ссылки на файлы ({uploadedFiles.length})
            </h3>
            {uploadedFiles.length > 1 && (
              <button
                onClick={copyAllLinks}
                className="px-3 py-1.5 rounded-lg bg-accent/20 text-accent-light text-sm font-medium hover:bg-accent/30 transition-colors"
              >
                {copiedToken === "all" ? "Скопировано!" : "Копировать все ссылки"}
              </button>
            )}
          </div>
          {uploadedFiles.map((file) => (
            <div
              key={file.token}
              className="glass rounded-xl p-4 flex items-center gap-4 glass-hover"
            >
              <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0">
                <svg
                  className="w-5 h-5 text-accent-light"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">
                  {file.isGroup ? `Пакет из ${file.fileCount} файлов` : file.name}
                </p>
                <p className="text-sm text-gray-400">
                  {file.isGroup
                    ? `${file.fileCount} файлов · ${formatFileSize(file.size)}`
                    : formatFileSize(file.size)}
                  {file.expiresAt && (
                    <span>
                      {" "}
                      · до{" "}
                      {new Date(file.expiresAt).toLocaleDateString("ru-RU")}
                    </span>
                  )}
                  {file.hasPassword && <span> · 🔒 с паролем</span>}
                  {file.storageEncrypted && <span> · 🛡️ зашифрован в хранилище</span>}
                </p>
              </div>
              <button
                onClick={() => copyLink(file.shareUrl, file.token)}
                className="px-4 py-2 rounded-lg bg-accent/20 text-accent-light text-sm font-medium hover:bg-accent/30 transition-colors flex-shrink-0"
              >
                {copiedToken === file.token ? "Скопировано!" : "Копировать"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
