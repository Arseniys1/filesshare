"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { AppLocale } from "@/i18n/routing";

const languages: Array<{ locale: AppLocale; countryCode: string }> = [
  { locale: "ru", countryCode: "ru" },
  { locale: "en", countryCode: "gb" },
  { locale: "es", countryCode: "es" },
  { locale: "de", countryCode: "de" },
];

export default function LanguageSwitcher() {
  const locale = useLocale() as AppLocale;
  const t = useTranslations("language");
  const [open, setOpen] = useState(false);
  const [pendingLocale, setPendingLocale] = useState<AppLocale | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const current = languages.find((language) => language.locale === locale) ?? languages[0];

  useEffect(() => {
    if (!pendingLocale || pendingLocale === locale) return;
    window.document.cookie = `NEXT_LOCALE=${pendingLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.location.reload();
  }, [locale, pendingLocale]);

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

  function handleChange(nextLocale: AppLocale) {
    if (nextLocale === locale) {
      setOpen(false);
      return;
    }

    setPendingLocale(nextLocale);
  }

  return (
    <div ref={containerRef} className="relative">
      {open && (
        <div
          role="menu"
          aria-label={t("label")}
          className="absolute bottom-14 right-0 w-44 overflow-hidden rounded-2xl border border-white/10 bg-surface-overlay/95 p-2 shadow-2xl shadow-black/20 backdrop-blur-xl animate-fade-in"
        >
          <div className="space-y-1">
            {languages.map((language) => (
              <button
                key={language.locale}
                type="button"
                role="menuitemradio"
                aria-checked={locale === language.locale}
                onClick={() => handleChange(language.locale)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                  locale === language.locale
                    ? "bg-accent/15 text-accent-light"
                    : "text-gray-400 hover:bg-white/5 hover:text-gray-300"
                }`}
              >
                <span className={`fi fi-${language.countryCode} h-4 w-6 shrink-0 rounded-sm`} aria-hidden="true" />
                <span className="flex-1">{t(language.locale)}</span>
                {locale === language.locale && (
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
        aria-label={`${t("label")}: ${t(current.locale)}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-overlay text-xl shadow-lg shadow-black/20 ring-1 ring-white/10 transition-all duration-200 hover:scale-105 hover:ring-accent/50 focus:outline-none focus:ring-4 focus:ring-accent/25 active:scale-95"
      >
        <span
          className={`fi fis fi-${current.countryCode} h-12 w-12 overflow-hidden rounded-full`}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
