"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import UserAvatar from "@/components/UserAvatar";

interface AuthUser {
  email: string;
  role: "user" | "admin";
  avatarSeed: string | null;
}

export default function AuthNav() {
  const t = useTranslations("nav");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const handleAvatarUpdate = (event: Event) => {
      const user = (event as CustomEvent<AuthUser>).detail;
      if (user) setUser(user);
    };

    window.addEventListener("user-avatar-updated", handleAvatarUpdate);
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((data: { user: AuthUser | null }) => setUser(data.user))
      .catch(() => setUser(null));

    return () => window.removeEventListener("user-avatar-updated", handleAvatarUpdate);
  }, []);

  if (!user) {
    return (
      <>
        <div className="hidden items-center gap-0.5 sm:flex sm:gap-2">
          <Link
            href="/docs/api"
            className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-white sm:px-3"
          >
            {t("api")}
          </Link>
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
        </div>
        <div className="relative sm:hidden">
          <button
            type="button"
            aria-label={t("menu")}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span>
          </button>
          {menuOpen && (
            <div
              id="mobile-navigation"
              className="absolute right-0 top-12 z-[70] min-w-52 rounded-xl border border-white/10 bg-surface-overlay/95 p-2 shadow-2xl backdrop-blur-xl"
            >
              <Link
                href="/docs/api"
                onClick={() => setMenuOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
              >
                {t("api")}
              </Link>
              <Link
                href="/login"
                onClick={() => setMenuOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
              >
                {t("login")}
              </Link>
              <Link
                href="/register"
                onClick={() => setMenuOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-sm text-accent-light hover:bg-white/10 hover:text-white"
              >
                {t("register")}
              </Link>
            </div>
          )}
        </div>
      </>
    );
  }

  const emailName = user.email.split("@", 1)[0] || user.email;

  return (
    <>
      <div className="hidden items-center gap-0.5 sm:flex sm:gap-2">
        <Link
          href="/docs/api"
          className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-white sm:px-3"
        >
          {t("api")}
        </Link>
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
          title={`${t("profile")}: ${user.email}`}
          className="flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm text-gray-500 transition-colors hover:bg-white/5 hover:text-white sm:max-w-40 sm:px-2"
        >
          <UserAvatar email={user.email} seed={user.avatarSeed} size={28} />
          <span className="max-w-24 truncate sm:max-w-40">{emailName}</span>
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
      </div>

      <div className="relative flex items-center gap-1 sm:hidden">
        <Link
          href="/profile"
          title={`${t("profile")}: ${user.email}`}
          className="flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-sm text-gray-500 transition-colors hover:bg-white/5 hover:text-white"
        >
          <UserAvatar email={user.email} seed={user.avatarSeed} size={28} />
          <span className="max-w-20 truncate">{emailName}</span>
        </Link>
        <button
          type="button"
          aria-label={t("menu")}
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          onClick={() => setMenuOpen((open) => !open)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span>
        </button>
        {menuOpen && (
          <div
            id="mobile-navigation"
            className="absolute right-0 top-12 z-[70] min-w-52 rounded-xl border border-white/10 bg-surface-overlay/95 p-2 shadow-2xl backdrop-blur-xl"
          >
            <Link
              href="/docs/api"
              onClick={() => setMenuOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
            >
              {t("api")}
            </Link>
            <Link
              href="/dashboard"
              onClick={() => setMenuOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
            >
              {t("myFiles")}
            </Link>
            {user.role === "admin" && (
              <Link
                href="/admin"
                onClick={() => setMenuOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
              >
                {t("admin")}
              </Link>
            )}
            <Link
              href="/profile"
              onClick={() => setMenuOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
            >
              {t("profile")}
            </Link>
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                window.location.href = "/";
              }}
              className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-gray-300 hover:bg-white/10 hover:text-white"
            >
              {t("logout")}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
