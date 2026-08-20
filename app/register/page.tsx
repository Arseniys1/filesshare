"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import GuestOnly from "@/components/GuestOnly";
import { useTranslations } from "next-intl";

export default function RegisterPage() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, passwordConfirmation, bootstrapToken }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(t("registerError"));
      window.location.href = data.user?.role === "admin" ? "/admin" : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : t("registerError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <GuestOnly>
      <div className="mx-auto max-w-md px-3 py-12 animate-fade-in sm:px-4 sm:py-24">
      <div className="glass rounded-2xl p-5 gradient-border sm:p-8">
        <h1 className="text-2xl font-bold text-center mb-2">{t("registerTitle")}</h1>
        <p className="text-gray-400 text-sm text-center mb-8">
          {t("registerDescription")}
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="register-email" className="block text-sm text-gray-400 mb-1.5">
              Email
            </label>
            <input
              id="register-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50"
            />
          </div>
          <div>
            <label htmlFor="register-bootstrap-token" className="block text-sm text-gray-400 mb-1.5">
              {t("bootstrapToken")}
            </label>
            <input
              id="register-bootstrap-token"
              type="password"
              value={bootstrapToken}
              onChange={(event) => setBootstrapToken(event.target.value)}
              autoComplete="off"
              className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50"
            />
          </div>
          <div>
            <label htmlFor="register-password" className="block text-sm text-gray-400 mb-1.5">
              {t("password")}
            </label>
            <input
              id="register-password"
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
            <label
              htmlFor="register-password-confirmation"
              className="block text-sm text-gray-400 mb-1.5"
            >
              {t("passwordConfirmation")}
            </label>
            <input
              id="register-password-confirmation"
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
            disabled={loading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? t("creatingAccount") : t("createAccount")}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-gray-400">
          {t("alreadyHaveAccount")}{" "}
          <Link href="/login" className="text-accent-light hover:underline">
            {t("login")}
          </Link>
        </p>
      </div>
      </div>
    </GuestOnly>
  );
}
