"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import GuestOnly from "@/components/GuestOnly";
import { useTranslations } from "next-intl";

export default function ResetPasswordPage() {
  const t = useTranslations("auth");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") || "");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, passwordConfirmation }),
      });
      if (!response.ok) throw new Error(t("changePasswordError"));
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("changePasswordError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <GuestOnly>
      <div className="mx-auto max-w-md px-3 py-12 animate-fade-in sm:px-4 sm:py-24">
      <div className="glass rounded-2xl p-5 gradient-border sm:p-8">
        <h1 className="text-2xl font-bold text-center mb-2">{t("newPasswordTitle")}</h1>
        {success ? (
          <div className="text-center">
            <p className="text-gray-300 mb-6">{t("passwordChanged")}</p>
            <Link
              href="/login"
              className="block py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium"
            >
              {t("goToLogin")}
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 mt-8">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">{t("newPasswordTitle")}</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">{t("passwordConfirmation")}</label>
              <input
                type="password"
                value={passwordConfirmation}
                onChange={(event) => setPasswordConfirmation(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
                className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50"
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading || !token}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? t("saving") : t("savePassword")}
            </button>
            {!token && (
              <p className="text-red-400 text-sm">{t("missingToken")}</p>
            )}
          </form>
        )}
      </div>
      </div>
    </GuestOnly>
  );
}
