"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import GuestOnly from "@/components/GuestOnly";
import { useTranslations } from "next-intl";

export default function LoginPage() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw new Error(t("loginError"));

      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href =
        next?.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loginError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <GuestOnly>
      <div className="mx-auto max-w-md px-3 py-12 animate-fade-in sm:px-4 sm:py-24">
      <div className="glass rounded-2xl p-5 gradient-border sm:p-8">
        <h1 className="text-2xl font-bold text-center mb-2">{t("loginTitle")}</h1>
        <p className="text-gray-400 text-sm text-center mb-8">
          {t("loginDescription")}
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-sm text-gray-400 mb-1.5">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-sm text-gray-400 mb-1.5">
              {t("password")}
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? t("loggingIn") : t("login")}
          </button>
        </form>
        <div className="mt-6 flex flex-col items-center gap-3 text-center text-sm sm:flex-row sm:justify-between">
          <Link href="/forgot-password" className="text-accent-light hover:underline">
            {t("forgotPassword")}
          </Link>
          <Link href="/register" className="text-accent-light hover:underline">
            {t("register")}
          </Link>
        </div>
      </div>
      </div>
    </GuestOnly>
  );
}
