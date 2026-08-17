"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface AuthUser {
  email: string;
  role: "user" | "admin";
}

export default function AuthNav() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((data: { user: AuthUser | null }) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  if (!user) {
    return (
      <>
        <Link
          href="/login"
          className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
        >
          Войти
        </Link>
        <Link
          href="/register"
          className="text-sm text-accent-light hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
        >
          Регистрация
        </Link>
      </>
    );
  }

  return (
    <>
      {user.role === "admin" && (
        <Link
          href="/admin"
          className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
        >
          Админ
        </Link>
      )}
      <span className="hidden sm:inline text-sm text-gray-500 max-w-40 truncate">
        {user.email}
      </span>
      <button
        type="button"
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.href = "/";
        }}
        className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
      >
        Выйти
      </button>
    </>
  );
}
