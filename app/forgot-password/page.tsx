"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import GuestOnly from "@/components/GuestOnly";
import { useTranslations } from "next-intl";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    setResetUrl(null);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      setMessage(data.message);
      setResetUrl(data.resetUrl || null);
    } catch {
      setMessage(t("sendError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <GuestOnly>
      <div className="mx-auto max-w-md px-3 py-12 animate-fade-in sm:px-4 sm:py-24">
      <div className="glass rounded-2xl p-5 gradient-border sm:p-8">
        <h1 className="text-2xl font-bold text-center mb-2">{t("forgotTitle")}</h1>
        <p className="text-gray-400 text-sm text-center mb-8">
          {t("forgotDescription")}
        </p>
        <form onSubmit={submit} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            required
            className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? t("sending") : t("sendLink")}
          </button>
        </form>
        {message && <p className="mt-5 text-sm text-gray-300">{message}</p>}
        {resetUrl && (
          <p className="mt-4 text-sm text-yellow-300 break-all">
            {t("devLink")} <Link href={resetUrl} className="underline">{t("openReset")}</Link>
          </p>
        )}
        <p className="mt-6 text-center text-sm">
          <Link href="/login" className="text-accent-light hover:underline">
            {t("backToLogin")}
          </Link>
        </p>
      </div>
      </div>
    </GuestOnly>
  );
}
