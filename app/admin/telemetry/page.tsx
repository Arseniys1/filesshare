"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

interface TelemetryEvent {
  id: number;
  event_name: string;
  consent_version: string;
  user_id: number | null;
  user_email: string | null;
  visitor_id: string;
  fingerprint_result: string | null;
  browser_tool_result: string | null;
  client_ip: string | null;
  server_ip: string | null;
  ip_hash: string | null;
  ip_hash_day: string | null;
  browser_family: string;
  os_family: string;
  device_type: string;
  language: string | null;
  viewport_bucket: string | null;
  path: string;
  created_at: string;
}

const TELEMETRY_LIMITS = [100, 250, 500] as const;

function displayValue(value: string | null | undefined, fallback: string) {
  return value || fallback;
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "medium" });
}

function formatJson(value: string | null) {
  if (!value) return "—";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function TelemetryField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-white/[0.03] px-3 py-2">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-gray-300">{value}</dd>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </h4>
      <pre className="max-h-80 overflow-auto rounded-lg bg-black/20 p-3 text-xs leading-5 text-gray-300">
        {formatJson(value)}
      </pre>
    </div>
  );
}

export default function AdminTelemetryPage() {
  const t = useTranslations("adminPages");
  const locale = useLocale();
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [limit, setLimit] = useState<number>(100);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTelemetry = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/telemetry?limit=${limit}`, {
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(t("telemetryLoadError"));
      setEvents(data.events as TelemetryEvent[]);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("telemetryLoadFailure"),
      );
    } finally {
      setLoading(false);
    }
  }, [limit, t]);

  useEffect(() => {
    void loadTelemetry();
  }, [loadTelemetry]);

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return events;
    return events.filter((event) =>
      [
        event.visitor_id,
        event.user_email,
        event.user_id === null ? null : String(event.user_id),
        event.path,
        event.client_ip,
        event.server_ip,
        event.ip_hash,
        event.browser_family,
        event.os_family,
        event.device_type,
        event.language,
        event.viewport_bucket,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [events, search]);

  const uniqueVisitors = useMemo(
    () => new Set(events.map((event) => event.visitor_id)).size,
    [events],
  );

  const anonymousEvents = useMemo(
    () => events.filter((event) => event.user_id === null).length,
    [events],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{t("telemetryTitle")}</h2>
          <p className="mt-1 text-gray-400">{t("telemetryDescription")}</p>
        </div>
        <button
          type="button"
          onClick={() => void loadTelemetry()}
          disabled={loading}
          className="self-start rounded-xl bg-accent/20 px-4 py-2.5 text-sm font-medium text-accent-light transition-colors hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
        >
          {loading ? t("telemetryRefreshing") : t("telemetryRefresh")}
        </button>
      </div>

      <div className="rounded-xl border border-accent/20 bg-accent/10 p-4 text-sm leading-6 text-gray-300">
        {t("telemetryPrivacyNote")}
      </div>

      {error && (
        <div className="glass rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="glass rounded-xl p-4">
          <p className="text-2xl font-bold gradient-text">{events.length}</p>
          <p className="mt-1 text-sm text-gray-400">{t("telemetryEvents")}</p>
        </div>
        <div className="glass rounded-xl p-4">
          <p className="text-2xl font-bold gradient-text">{uniqueVisitors}</p>
          <p className="mt-1 text-sm text-gray-400">{t("telemetryVisitors")}</p>
        </div>
        <div className="glass col-span-2 rounded-xl p-4 sm:col-span-1">
          <p className="text-2xl font-bold gradient-text">
            {filteredEvents.length}
          </p>
          <p className="mt-1 text-sm text-gray-400">{t("telemetryShown")}</p>
        </div>
        <div className="glass col-span-2 rounded-xl p-4 sm:col-span-3">
          <p className="text-sm text-gray-300">
            {t("telemetryAnonymous")}: {anonymousEvents}
          </p>
        </div>
      </div>

      <div className="glass rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t("telemetrySearchAria")}</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("telemetrySearch")}
              aria-label={t("telemetrySearchAria")}
              className="w-full rounded-lg border border-white/10 bg-surface-overlay px-3 py-2.5 text-sm focus:border-accent/50 focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <span>{t("telemetryLimit")}</span>
            <select
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              aria-label={t("telemetryLimit")}
              className="rounded-lg border border-white/10 bg-surface-overlay px-3 py-2.5 text-sm text-gray-300 focus:border-accent/50 focus:outline-none"
            >
              {TELEMETRY_LIMITS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="glass rounded-2xl p-12 text-center text-sm text-gray-500">
            {t("loading")}
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="glass rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-gray-500">
            {search ? t("telemetryNoMatches") : t("telemetryNoEvents")}
          </div>
        ) : (
          filteredEvents.map((event) => (
            <article key={event.id} className="glass rounded-2xl p-4 sm:p-5">
              <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-accent/15 px-2 py-1 text-xs font-medium text-accent-light">
                      {event.event_name}
                    </span>
                    <code className="break-all text-sm text-gray-300">
                      {event.path}
                    </code>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    {formatDate(event.created_at, locale)}
                  </p>
                </div>
                <div className="min-w-0 text-left sm:max-w-[45%] sm:text-right">
                  <p className="text-xs text-gray-500">{t("telemetryUser")}</p>
                  <p className="break-all text-sm text-gray-300">
                    {event.user_email ||
                      (event.user_id === null
                        ? t("telemetryAnonymousUser")
                        : `#${event.user_id}`)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">{t("telemetryVisitor")}</p>
                  <code className="break-all text-xs text-gray-300">
                    {event.visitor_id}
                  </code>
                </div>
              </div>

              <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <TelemetryField
                  label={t("telemetryBrowser")}
                  value={displayValue(event.browser_family, t("telemetryUnknown"))}
                />
                <TelemetryField
                  label={t("telemetryOs")}
                  value={displayValue(event.os_family, t("telemetryUnknown"))}
                />
                <TelemetryField
                  label={t("telemetryDevice")}
                  value={displayValue(event.device_type, t("telemetryUnknown"))}
                />
                <TelemetryField
                  label={t("telemetryLanguage")}
                  value={displayValue(event.language, t("telemetryUnknown"))}
                />
                <TelemetryField
                  label={t("telemetryViewport")}
                  value={displayValue(event.viewport_bucket, t("telemetryUnknown"))}
                />
                <TelemetryField
                  label={t("telemetryClientIp")}
                  value={displayValue(event.client_ip, t("telemetryUnknown"))}
                />
                <TelemetryField
                  label={t("telemetryServerIp")}
                  value={displayValue(event.server_ip, t("telemetryUnknown"))}
                />
                <TelemetryField
                  label={t("telemetryIpHash")}
                  value={displayValue(event.ip_hash, t("telemetryUnknown"))}
                />
              </dl>

              <details className="mt-4 border-t border-white/10 pt-3">
                <summary className="cursor-pointer text-sm text-accent-light hover:text-accent-light/80">
                  {t("telemetryShowDetails")}
                </summary>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <JsonBlock
                    label={t("telemetryFingerprint")}
                    value={event.fingerprint_result}
                  />
                  <JsonBlock
                    label={t("telemetryBrowserTool")}
                    value={event.browser_tool_result}
                  />
                </div>
                <p className="mt-4 text-xs text-gray-500">
                  {t("telemetryConsent")}: {event.consent_version} · {t("telemetryIpHashDay")}: {displayValue(event.ip_hash_day, t("telemetryUnknown"))}
                </p>
              </details>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
