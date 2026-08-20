"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export type ThemeMode = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "filesshare-theme";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function applyTheme(mode: ThemeMode): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = mode === "dark" || (mode === "system" && prefersDark);
  const root = document.documentElement;

  root.classList.toggle("dark", isDark);
  root.classList.toggle("light", !isDark);
  root.dataset.theme = isDark ? "dark" : "light";
  root.dataset.themeMode = mode;
  root.style.colorScheme = isDark ? "dark" : "light";
}

function ThemeIcon({ mode, size = 18 }: { mode: ThemeMode; size?: number }) {
  if (mode === "light") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (mode === "dark") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function ThemeToggle() {
  const t = useTranslations("theme");
  const [mode, setMode] = useState<ThemeMode>("system");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeMode(stored)) setMode(stored);
  }, []);

  useEffect(() => {
    applyTheme(mode);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (mode === "system") applyTheme("system");
    };

    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [mode]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleChange(nextMode: ThemeMode) {
    setMode(nextMode);
    localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    applyTheme(nextMode);
    setOpen(false);
  }

  const themeOptions: Array<{ mode: ThemeMode; label: string }> = [
    { mode: "system", label: t("system") },
    { mode: "light", label: t("light") },
    { mode: "dark", label: t("dark") },
  ];

  return (
    <div ref={containerRef} className="relative">
      {open && (
        <div
          role="menu"
          aria-label={t("menu")}
          className="absolute bottom-14 right-0 w-44 overflow-hidden rounded-2xl border border-white/10 bg-surface-overlay/95 p-2 shadow-2xl shadow-black/20 backdrop-blur-xl animate-fade-in"
        >
          <div className="space-y-1">
            {themeOptions.map((option) => (
              <button
                key={option.mode}
                type="button"
                role="menuitemradio"
                aria-checked={mode === option.mode}
                onClick={() => handleChange(option.mode)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                  mode === option.mode
                    ? "bg-accent/15 text-accent-light"
                    : "text-gray-400 hover:bg-white/5 hover:text-gray-300"
                }`}
              >
                <ThemeIcon mode={option.mode} size={17} />
                <span className="flex-1">{option.label}</span>
                {mode === option.mode && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        aria-label={t("label")}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 transition-all duration-200 hover:scale-105 hover:bg-accent-glow focus:outline-none focus:ring-4 focus:ring-accent/25 active:scale-95"
      >
        <ThemeIcon mode={mode} size={20} />
      </button>
    </div>
  );
}
