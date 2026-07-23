"use client";

import { useEffect, useState, useCallback } from "react";
import { formatFileSize } from "@/lib/utils";

interface StorageAccount {
  id: number;
  name: string;
  channelId: string;
  isActive: boolean;
  filesCount: number;
  createdAt: string;
  botToken: string;
}

interface Stats {
  totalFiles: number;
  totalSize: number;
  activeAccounts: number;
  expiredFiles: number;
}

export default function AdminPage() {
  const [accounts, setAccounts] = useState<StorageAccount[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    botToken: "",
    channelId: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [adminKey, setAdminKey] = useState("");
  const [needsAuth, setNeedsAuth] = useState(false);
  const [skipConnectionTest, setSkipConnectionTest] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem("adminKey");
    if (saved) setAdminKey(saved);
  }, []);

  const getHeaders = useCallback(() => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (adminKey) {
      headers["Authorization"] = `Bearer ${adminKey}`;
    }
    return headers;
  }, [adminKey]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/accounts", {
        headers: getHeaders(),
      });

      if (res.status === 401) {
        setNeedsAuth(true);
        setLoading(false);
        return;
      }

      if (!res.ok) {
        throw new Error(`Ошибка сервера (${res.status})`);
      }

      const data = await res.json();
      setAccounts(data.accounts);
      setStats(data.stats);
      setNeedsAuth(false);
      if (adminKey) sessionStorage.setItem("adminKey", adminKey);
    } catch (err) {
      const msg =
        err instanceof TypeError
          ? "Сервер недоступен. Убедитесь, что npm run dev запущен."
          : err instanceof Error
            ? err.message
            : "Ошибка загрузки данных";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [getHeaders, adminKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          ...formData,
          testConnection: !skipConnectionTest,
        }),
      });

      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        throw new Error(`Сервер вернул некорректный ответ (${res.status})`);
      }

      if (!res.ok) {
        throw new Error(data.error || `Ошибка (${res.status})`);
      }

      setSuccess("Аккаунт успешно добавлен!");
      setFormData({ name: "", botToken: "", channelId: "" });
      setShowForm(false);
      fetchData();
    } catch (err) {
      const msg =
        err instanceof TypeError
          ? "Не удалось связаться с сервером. Проверьте, что npm run dev запущен и вы на правильном порту (localhost:3000)."
          : err instanceof Error
            ? err.message
            : "Ошибка";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleAccount = async (id: number, isActive: boolean) => {
    await fetch("/api/admin/accounts", {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ id, isActive: !isActive }),
    });
    fetchData();
  };

  const deleteAccount = async (account: StorageAccount) => {
    if (account.filesCount > 0) {
      setError(
        "Нельзя удалить аккаунт с файлами. Отключите его — существующие ссылки продолжат работать до очистки."
      );
      return;
    }
    if (!confirm("Удалить этот пустой аккаунт?")) return;

    const res = await fetch(`/api/admin/accounts?id=${account.id}`, {
      method: "DELETE",
      headers: getHeaders(),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Не удалось удалить аккаунт");
      return;
    }
    fetchData();
  };

  if (needsAuth) {
    return (
      <div className="max-w-md mx-auto px-4 py-32 animate-fade-in">
        <div className="glass rounded-2xl p-8 gradient-border">
          <h1 className="text-2xl font-bold mb-4 text-center">Админ-панель</h1>
          <p className="text-gray-400 text-sm mb-6 text-center">
            Введите ключ из файла <code className="text-accent-light">.env</code> (ADMIN_KEY)
          </p>
          <input
            type="password"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (setLoading(true), fetchData())}
            placeholder="your-secret-admin-key-here"
            className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50 mb-4"
          />
          {error && (
            <p className="text-red-400 text-sm mb-4 text-center">{error}</p>
          )}
          <button
            onClick={() => {
              setLoading(true);
              fetchData();
            }}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium hover:opacity-90 transition-opacity"
          >
            Войти
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-32 text-center">
        <div className="w-12 h-12 mx-auto border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 animate-fade-in">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">
            Админ<span className="gradient-text">-панель</span>
          </h1>
          <p className="text-gray-400 mt-1">
            Управление Telegram-аккаунтами для хранения
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-5 py-2.5 rounded-xl bg-accent/20 text-accent-light font-medium hover:bg-accent/30 transition-colors"
        >
          {showForm ? "Отмена" : "+ Добавить бота"}
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
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

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="glass rounded-2xl p-6 mb-8 space-y-4 animate-slide-up"
        >
          <h3 className="font-medium">Новый Telegram-бот</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Название</label>
              <input
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="Основной бот"
                required
                className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">
                ID канала
              </label>
              <input
                value={formData.channelId}
                onChange={(e) =>
                  setFormData({ ...formData, channelId: e.target.value })
                }
                placeholder="-1001234567890"
                required
                className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              Токен бота
            </label>
            <input
              value={formData.botToken}
              onChange={(e) =>
                setFormData({ ...formData, botToken: e.target.value })
              }
              placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              required
              className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50 font-mono"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={skipConnectionTest}
              onChange={(e) => setSkipConnectionTest(e.target.checked)}
              className="rounded border-white/20"
            />
            Пропустить проверку подключения к Telegram
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? "Проверка и добавление..." : "Добавить"}
          </button>
        </form>
      )}

      {error && (
        <div className="glass rounded-xl p-4 border border-red-500/30 bg-red-500/10 mb-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {success && (
        <div className="glass rounded-xl p-4 border border-green-500/30 bg-green-500/10 mb-4">
          <p className="text-green-400 text-sm">{success}</p>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <div className="text-5xl mb-4">🤖</div>
          <h3 className="text-xl font-medium mb-2">Нет аккаунтов</h3>
          <p className="text-gray-400 text-sm mb-6">
            Добавьте Telegram-бота для начала работы
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="px-6 py-2.5 rounded-xl bg-accent/20 text-accent-light font-medium hover:bg-accent/30 transition-colors"
          >
            Добавить первого бота
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="glass rounded-xl p-5 flex items-center gap-4 glass-hover"
            >
              <div
                className={`w-3 h-3 rounded-full flex-shrink-0 ${
                  account.isActive ? "bg-green-400" : "bg-gray-600"
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium">{account.name}</p>
                <p className="text-sm text-gray-400">
                  {account.botToken} · Канал: {account.channelId} ·{" "}
                  {account.filesCount} файлов
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => toggleAccount(account.id, account.isActive)}
                  className="px-3 py-1.5 rounded-lg text-sm bg-white/5 hover:bg-white/10 transition-colors"
                >
                  {account.isActive ? "Выключить" : "Включить"}
                </button>
                <button
                  onClick={() => deleteAccount(account)}
                  disabled={account.filesCount > 0}
                  title={
                    account.filesCount > 0
                      ? "Сначала дождитесь очистки файлов или отключите аккаунт"
                      : undefined
                  }
                  className="px-3 py-1.5 rounded-lg text-sm text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-12 glass rounded-2xl p-6">
        <h3 className="font-medium mb-4">Как настроить Telegram-бота</h3>
        <ol className="space-y-3 text-sm text-gray-400 list-decimal list-inside">
          <li>
            Создайте бота через{" "}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-light hover:underline"
            >
              @BotFather
            </a>{" "}
            и получите токен
          </li>
          <li>
            Создайте приватный канал в Telegram для хранения файлов
          </li>
          <li>
            Добавьте бота в канал как администратора с правом публикации
          </li>
          <li>
            Узнайте ID канала (начинается с -100...) через{" "}
            <a
              href="https://t.me/userinfobot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-light hover:underline"
            >
              @userinfobot
            </a>{" "}
            или перешлите сообщение из канала в{" "}
            <a
              href="https://t.me/RawDataBot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-light hover:underline"
            >
              @RawDataBot
            </a>
          </li>
          <li>Добавьте бота и канал в форму выше</li>
        </ol>
      </div>
    </div>
  );
}
