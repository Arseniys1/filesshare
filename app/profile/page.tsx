"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/utils";

interface ProfileUser {
  email: string;
}

interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

interface ApiKeyPage {
  items: ApiKey[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const EMPTY_PAGE: ApiKeyPage = { items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 };

export default function ProfilePage() {
  const t = useTranslations("profile");
  const navT = useTranslations("nav");
  const locale = useLocale();
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyPage>(EMPTY_PAGE);
  const [page, setPage] = useState(1);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const authResponse = await fetch("/api/auth/me");
      const authData = await authResponse.json();
      if (!authData.user) {
        setUnauthenticated(true);
        return;
      }
      setUser(authData.user);

      const keysResponse = await fetch(`/api/user/api-keys?page=${page}&pageSize=10`);
      const keysData = await keysResponse.json().catch(() => ({}));
      if (keysResponse.status === 401) {
        setUnauthenticated(true);
        return;
      }
      if (!keysResponse.ok) throw new Error(keysData.error || t("loadingKeys"));
      setApiKeys({ ...EMPTY_PAGE, ...keysData });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("loadingKeys"));
    } finally {
      setLoading(false);
    }
  }, [page, t]);

  useEffect(() => {
    load();
  }, [load]);

  const createApiKey = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/user/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t("createKey"));
      setName("");
      setSecret(data.secret);
      if (page !== 1) setPage(1);
      else await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t("createKey"));
    } finally {
      setSaving(false);
    }
  };

  const revokeApiKey = async (key: ApiKey) => {
    if (!window.confirm(`Отозвать API-ключ «${key.name}»?`)) return;
    setError(null);
    try {
      const response = await fetch(`/api/user/api-keys/${key.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t("revoke"));
      if (apiKeys.items.length === 1 && page > 1) setPage(page - 1);
      else await load();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : t("revoke"));
    }
  };

  if (unauthenticated) {
    return (
      <div className="mx-auto max-w-md px-4 py-32">
        <div className="glass gradient-border rounded-2xl p-8 text-center">
          <h1 className="mb-3 text-2xl font-bold">{t("title")}</h1>
          <p className="mb-6 text-sm text-gray-400">{t("loginRequired")}</p>
          <Link href="/login?next=/profile" className="block rounded-xl bg-gradient-to-r from-accent to-purple-600 py-3 font-medium text-white">{navT("login")}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl animate-fade-in px-3 py-8 sm:px-4 sm:py-12">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="mt-1 text-gray-400">{user?.email || "Загрузка..."}</p>
        </div>
        <Link href="/dashboard" className="self-start rounded-xl bg-accent/20 px-4 py-2.5 text-sm font-medium text-accent-light hover:bg-accent/30 sm:self-auto">{navT("myFiles")}</Link>
      </div>

      {error && <div className="mb-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      <section className="glass mb-6 rounded-2xl p-4 sm:p-5">
        <div className="mb-4">
          <h2 className="font-semibold">{t("apiKeys")}</h2>
          <p className="mt-1 text-xs text-gray-500">{t("apiKeysDescription")}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && name.trim() && !saving) createApiKey(); }}
            placeholder={t("integrationName")}
            maxLength={64}
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-surface-overlay px-4 py-2.5 text-sm focus:border-accent/50 focus:outline-none"
          />
          <button type="button" onClick={createApiKey} disabled={saving || !name.trim()} className="w-full rounded-xl bg-accent/20 px-4 py-2.5 text-sm font-medium text-accent-light disabled:opacity-40 sm:w-auto">
            {saving ? t("creating") : t("createKey")}
          </button>
        </div>

        {secret && (
          <div className="mt-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
            <p className="font-medium text-sm text-yellow-300">{t("saveSecret")}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-xs text-gray-200">{secret}</code>
              <button type="button" onClick={() => navigator.clipboard.writeText(secret)} className="shrink-0 rounded-lg bg-white/10 px-3 py-2 text-xs">{t("copy")}</button>
            </div>
            <button type="button" onClick={() => setSecret(null)} className="mt-3 text-xs text-gray-400 hover:text-white">{t("hideSecret")}</button>
          </div>
        )}

        {loading ? (
          <p className="mt-5 text-sm text-gray-500">{t("loadingKeys")}</p>
        ) : apiKeys.items.length > 0 ? (
          <div className="mt-5 space-y-2">
            {apiKeys.items.map((key) => (
              <div key={key.id} className="flex flex-col gap-3 rounded-xl bg-white/5 px-3 py-3 text-sm sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{key.name}</span>
                    <code className="text-xs text-gray-500">{key.prefix}</code>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {t("created")} {formatDate(key.createdAt, locale)} · {key.lastUsedAt ? `${t("used")} ${formatDate(key.lastUsedAt, locale)}` : t("notUsed")}
                  </p>
                </div>
                <button type="button" onClick={() => revokeApiKey(key)} className="self-start rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 sm:self-auto">{t("revoke")}</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-5 text-sm text-gray-500">{t("noKeys")}</p>
        )}

        {apiKeys.totalPages > 1 && (
          <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4 text-sm">
            <button type="button" onClick={() => setPage((current) => current - 1)} disabled={page <= 1 || loading} className="rounded-lg px-3 py-2 text-gray-400 hover:bg-white/10 hover:text-white disabled:opacity-30">{t("back")}</button>
            <span className="text-xs text-gray-500">{t("page", { page: apiKeys.page, total: apiKeys.totalPages })}</span>
            <button type="button" onClick={() => setPage((current) => current + 1)} disabled={page >= apiKeys.totalPages || loading} className="rounded-lg px-3 py-2 text-gray-400 hover:bg-white/10 hover:text-white disabled:opacity-30">{t("forward")}</button>
          </div>
        )}
      </section>
    </div>
  );
}
