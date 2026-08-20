"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface AuthUser {
  email: string;
  role: "user" | "admin";
}

export default function AuthNav() {
  const t = useTranslations("nav");
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((data: { user: AuthUser | null }) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  if (!user) {
    return (
      <>
        <Link
          href="/login"
          className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-white sm:px-3"
        >
          {t("login")}
        </Link>
        <Link
          href="/register"
          className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm text-accent-light transition-colors hover:bg-white/5 hover:text-white sm:px-3"
        >
          {t("register")}
        </Link>
      </>
    );
  }

  return (
    <>
      <Link
        href="/dashboard"
        className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-white sm:px-3"
      >
        {t("myFiles")}
      </Link>
      {user.role === "admin" && (
        <Link
          href="/admin"
          className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-white sm:px-3"
        >
        {t("admin")}
        </Link>
      )}
      <Link
        href="/profile"
        title={t("profile")}
        className="hidden max-w-40 shrink-0 truncate text-sm text-gray-500 transition-colors hover:text-white sm:inline"
      >
        {user.email}
      </Link>
      <button
        type="button"
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.href = "/";
        }}
        className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-white sm:px-3"
      >
        {t("logout")}
      </button>
    </>
  );
}
