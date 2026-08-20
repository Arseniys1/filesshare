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
        className="flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm text-gray-500 transition-colors hover:bg-white/5 hover:text-white sm:max-w-40 sm:px-2"
      >
        <UserAvatar email={user.email} seed={user.avatarSeed} size={28} />
        <span className="hidden max-w-40 truncate sm:inline">{user.email}</span>
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
