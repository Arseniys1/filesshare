"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function LoginPage() {
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
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось войти");

      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href =
        next?.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось войти");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-24 animate-fade-in">
      <div className="glass rounded-2xl p-8 gradient-border">
        <h1 className="text-2xl font-bold text-center mb-2">Вход</h1>
        <p className="text-gray-400 text-sm text-center mb-8">
          Войдите в аккаунт FileShare
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Пароль</label>
            <input
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
            {loading ? "Входим..." : "Войти"}
          </button>
        </form>
        <div className="mt-6 flex justify-between text-sm">
          <Link href="/forgot-password" className="text-accent-light hover:underline">
            Забыли пароль?
          </Link>
          <Link href="/register" className="text-accent-light hover:underline">
            Регистрация
          </Link>
        </div>
      </div>
    </div>
  );
}
