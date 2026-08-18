"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import type { GetResult } from "@fingerprintjs/fingerprintjs";
import { TELEMETRY_CONSENT_VERSION } from "@/lib/telemetry-constants";

function getViewportBucket(): "compact" | "standard" | "wide" {
  if (window.innerWidth < 640) return "compact";
  if (window.innerWidth < 1280) return "standard";
  return "wide";
}

export default function Telemetry() {
  const pathname = usePathname() || "/";
  const fingerprintPromise = useRef<Promise<{ get: () => Promise<GetResult> }> | null>(null);

  useEffect(() => {
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
  }, [pathname]);

  return null;
}
