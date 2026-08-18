"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { GetResult } from "@fingerprintjs/fingerprintjs";
import { TELEMETRY_CONSENT_VERSION } from "@/lib/telemetry-constants";

const CONSENT_STORAGE_KEY = "filesshare-telemetry-consent";
type ConsentChoice = "granted" | "denied";

function getViewportBucket(): "compact" | "standard" | "wide" {
  if (window.innerWidth < 640) return "compact";
  if (window.innerWidth < 1280) return "standard";
  return "wide";
}

export default function PrivacyConsent() {
  const pathname = usePathname() || "/";
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const fingerprintPromise = useRef<Promise<{ get: () => Promise<GetResult> }> | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (stored === "granted" || stored === "denied") setChoice(stored);
    else setChoice(null);
  }, []);

  useEffect(() => {
    if (choice !== "granted") return;

    let cancelled = false;
    void (async () => {
      const fingerprintModule = await import("@fingerprintjs/fingerprintjs");
      const browserToolModule = await import("browser-tool");
      if (!fingerprintPromise.current) {
        fingerprintPromise.current = fingerprintModule.default
          .load({ monitoring: false })
          .then((agent) => ({ get: () => agent.get() }));
      }

      const agent = await fingerprintPromise.current;
      const result = await agent.get();
      const browserToolResult = await browserToolModule.default.getInfo();
      if (cancelled) return;

      await fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify({
          eventName: "page_view",
          consentVersion: TELEMETRY_CONSENT_VERSION,
          fingerprintResult: result,
          browserToolResult,
          clientIp: browserToolResult.ip ?? null,
          path: pathname,
          language: navigator.language,
          viewportBucket: getViewportBucket(),
        }),
      });
    })().catch(() => {
      // Telemetry must never affect the application when a browser blocks it.
    });

    return () => {
      cancelled = true;
    };
  }, [choice, pathname]);

  function choose(nextChoice: ConsentChoice) {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, nextChoice);
    setChoice(nextChoice);
  }

  if (choice !== null) return null;

  return (
    <aside className="fixed bottom-4 left-4 right-4 z-[60] mx-auto max-w-2xl glass rounded-2xl border border-accent/30 p-5 shadow-2xl">
      <p className="font-medium">Настройки приватности</p>
      <p className="mt-2 text-sm leading-6 text-gray-400">
        С разрешения мы используем FingerprintJS и browser-tool для защиты и
        статистики: сохраняем технические характеристики, GPU, IP клиента,
        адрес страницы и IP соединения сервера. IP также сохраняется в виде
        ежедневно меняющегося HMAC-хэша.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => choose("granted")}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light"
        >
          Разрешить
        </button>
        <button
          type="button"
          onClick={() => choose("denied")}
          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
        >
          Только необходимое
        </button>
      </div>
    </aside>
  );
}
