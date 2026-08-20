"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

interface AdminShellProps {
  children: ReactNode;
}

type AuthState = "loading" | "allowed" | "unauthenticated" | "forbidden";

const navigation = [
  { href: "/admin", label: "Обзор", icon: "⌂" },
  { href: "/admin/users", label: "Пользователи", icon: "👥" },
  { href: "/admin/files", label: "Файлы", icon: "📁" },
  { href: "/admin/bots", label: "Боты", icon: "🤖" },
];

export default function AdminShell({ children }: AdminShellProps) {
  const pathname = usePathname() || "/admin";
  const [authState, setAuthState] = useState<AuthState>("loading");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/me")
      .then((response) => response.json() as Promise<{ user: { role: string } | null }>)
      .then(({ user }) => {
        if (cancelled) return;
        setAuthState(!user ? "unauthenticated" : user.role === "admin" ? "allowed" : "forbidden");
      })
      .catch(() => {
        if (!cancelled) setAuthState("unauthenticated");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (authState === "loading") {
    return (
      <div className="max-w-4xl mx-auto px-4 py-32 text-center">
        <div className="w-12 h-12 mx-auto border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (authState === "unauthenticated") {
    return (
      <div className="max-w-md mx-auto px-4 py-32 animate-fade-in">
        <div className="glass rounded-2xl p-8 gradient-border">
          <h1 className="text-2xl font-bold mb-4 text-center">Админ-панель</h1>
          <p className="text-gray-400 text-sm mb-6 text-center">
            Для доступа к панели войдите в аккаунт администратора.
          </p>
          <Link
            href={`/login?next=${pathname}`}
            className="block text-center w-full py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium hover:opacity-90 transition-opacity"
          >
            Войти
          </Link>
        </div>
      </div>
    );
  }

  if (authState === "forbidden") {
    return (
      <div className="max-w-md mx-auto px-4 py-32 animate-fade-in">
        <div className="glass rounded-2xl p-8 text-center gradient-border">
          <h1 className="text-2xl font-bold mb-4">Недостаточно прав</h1>
          <p className="text-gray-400 text-sm">
            Админ-панель доступна только пользователям с ролью администратора.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-3 py-8 animate-fade-in sm:px-4 sm:py-12">
      <div className="mb-6 sm:mb-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">
              Админ<span className="gradient-text">-панель</span>
            </h1>
            <p className="text-gray-400 mt-1">Управление FileShare</p>
          </div>
          <nav aria-label="Разделы админ-панели" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {navigation.map((item) => {
              const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-w-0 items-center gap-2 rounded-xl px-3 py-2.5 text-sm transition-colors sm:px-3.5 ${
                    active
                      ? "bg-accent/20 text-accent-light ring-1 ring-accent/30"
                      : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200"
                  }`}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      {children}
    </div>
  );
}
