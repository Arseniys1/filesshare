"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import GuestOnly from "@/components/GuestOnly";

export default function ResetPasswordPage() {
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
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось изменить пароль");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить пароль");
    } finally {
      setLoading(false);
    }
  }

  return (
    <GuestOnly>
      <div className="max-w-md mx-auto px-4 py-24 animate-fade-in">
      <div className="glass rounded-2xl p-8 gradient-border">
        <h1 className="text-2xl font-bold text-center mb-2">Новый пароль</h1>
        {success ? (
          <div className="text-center">
            <p className="text-gray-300 mb-6">Пароль изменён. Теперь можно войти.</p>
            <Link
              href="/login"
              className="block py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium"
            >
              Перейти ко входу
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 mt-8">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Новый пароль</label>
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
              <label className="block text-sm text-gray-400 mb-1.5">Повторите пароль</label>
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
              {loading ? "Сохраняем..." : "Сохранить пароль"}
            </button>
            {!token && (
              <p className="text-red-400 text-sm">В ссылке отсутствует токен восстановления.</p>
            )}
          </form>
        )}
      </div>
      </div>
    </GuestOnly>
  );
}
