"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatFileSize } from "@/lib/utils";

interface Stats {
  totalFiles: number;
  totalSize: number;
  activeAccounts: number;
  expiredFiles: number;
}

interface AdminAudit {
  id: number;
  admin_email: string;
  action: string;
  target_type: string;
  target_id: string | null;
  created_at: string;
}

const sections = [
  { href: "/admin/users", icon: "👥", title: "Пользователи", description: "Роли, блокировки, квоты и текущая загрузка аккаунтов." },
  { href: "/admin/files", icon: "📁", title: "Файлы", description: "Поиск файлов, контроль ссылок и удаление из Telegram." },
  { href: "/admin/bots", icon: "🤖", title: "Telegram-боты", description: "Хранилища, каналы и состояние подключенных ботов." },
];

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [auditEvents, setAuditEvents] = useState<AdminAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/accounts").then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить статистику");
        return response.json() as Promise<{ stats: Stats }>;
      }),
      fetch("/api/admin/audit?limit=10").then(async (response) => {
        if (!response.ok) return { events: [] };
        return response.json() as Promise<{ events: AdminAudit[] }>;
      }),
    ])
      .then(([accountsData, auditData]) => {
        setStats(accountsData.stats);
        setAuditEvents(auditData.events);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Ошибка загрузки данных");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="glass rounded-2xl p-12 text-center text-gray-400">Загрузка обзора...</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="glass rounded-xl p-4 border border-red-500/30 bg-red-500/10">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Файлов", value: stats.totalFiles },
            { label: "Общий размер", value: formatFileSize(stats.totalSize) },
            { label: "Активных ботов", value: stats.activeAccounts },
            { label: "Истекло", value: stats.expiredFiles },
          ].map((stat) => (
            <div key={stat.label} className="glass rounded-xl p-4 text-center">
              <p className="text-2xl font-bold gradient-text">{stat.value}</p>
              <p className="text-sm text-gray-400 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {sections.map((section) => (
          <Link key={section.href} href={section.href} className="glass glass-hover rounded-2xl p-5 group">
            <div className="flex items-start justify-between gap-4">
              <span className="text-3xl" aria-hidden="true">{section.icon}</span>
              <span className="text-gray-600 transition-colors group-hover:text-accent-light">→</span>
            </div>
            <h2 className="mt-5 font-medium">{section.title}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-400">{section.description}</p>
          </Link>
        ))}
      </div>

      <div className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="font-medium">Последние действия</h2>
            <p className="text-xs text-gray-500 mt-1">Журнал действий администраторов</p>
          </div>
          <span className="text-xs text-gray-500">10 последних</span>
        </div>
        {auditEvents.length > 0 ? (
          <div className="space-y-2 text-sm">
            {auditEvents.map((event) => (
              <div key={event.id} className="flex flex-wrap gap-x-3 gap-y-1 border-b border-white/5 pb-2 text-gray-400 last:border-0 last:pb-0">
                <span className="text-gray-300">{event.admin_email}</span>
                <span>{event.action}</span>
                <span>{event.target_type}{event.target_id ? ` #${event.target_id}` : ""}</span>
                <span className="text-gray-600">{event.created_at}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-gray-500">Действий пока нет</p>
        )}
      </div>
    </div>
  );
}
