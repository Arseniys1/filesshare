"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import ThemedCheckbox from "@/components/ThemedCheckbox";

interface StorageAccount {
  id: number;
  name: string;
  channelId: string;
  isActive: boolean;
  filesCount: number;
  createdAt: string;
  botToken: string;
}

export default function AdminBotsPage() {
  const t = useTranslations("adminPages");
  const [accounts, setAccounts] = useState<StorageAccount[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    botToken: "",
    channelId: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [skipConnectionTest, setSkipConnectionTest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/accounts");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t("botLoadError"));
      setAccounts(data.accounts);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("botLoadFailure"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          testConnection: !skipConnectionTest,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          data.error || `${t("botAddError")} (${response.status})`,
        );
      setSuccess(t("botAdded"));
      setFormData({ name: "", botToken: "", channelId: "" });
      setShowForm(false);
      await loadAccounts();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("botAddError"));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleAccount = async (account: StorageAccount) => {
    setError(null);
    const response = await fetch("/api/admin/accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: account.id, isActive: !account.isActive }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || t("botStateError"));
      return;
    }
    await loadAccounts();
  };

  const deleteAccount = async (account: StorageAccount) => {
    if (account.filesCount > 0) {
      setError(t("botDeleteBlocked"));
      return;
    }
    if (!confirm(t("botDeleteConfirm"))) return;
    setError(null);
    const response = await fetch(`/api/admin/accounts?id=${account.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || t("botDeleteError"));
      return;
    }
    setSuccess(t("botDeleted"));
    await loadAccounts();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{t("botsTitle")}</h2>
          <p className="text-gray-400 mt-1">{t("botsDescription")}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((current) => !current)}
          className="self-start px-5 py-2.5 rounded-xl bg-accent/20 text-accent-light font-medium hover:bg-accent/30 transition-colors sm:self-auto"
        >
          {showForm ? t("cancel") : t("addBot")}
        </button>
      </div>

      {error && (
        <div className="glass rounded-xl p-4 border border-red-500/30 bg-red-500/10">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
      {success && (
        <div className="glass rounded-xl p-4 border border-green-500/30 bg-green-500/10">
          <p className="text-green-400 text-sm">{success}</p>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="glass space-y-4 rounded-2xl p-4 animate-slide-up sm:p-6"
        >
          <h3 className="font-medium">{t("newBot")}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">
                {t("name")}
              </label>
              <input
                value={formData.name}
                onChange={(event) =>
                  setFormData({ ...formData, name: event.target.value })
                }
                placeholder={t("mainBot")}
                required
                className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">
                {t("channelId")}
              </label>
              <input
                value={formData.channelId}
                onChange={(event) =>
                  setFormData({ ...formData, channelId: event.target.value })
                }
                placeholder="-1001234567890"
                required
                className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              {t("botToken")}
            </label>
            <input
              value={formData.botToken}
              onChange={(event) =>
                setFormData({ ...formData, botToken: event.target.value })
              }
              placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              required
              className="w-full bg-surface-overlay border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-accent/50 font-mono"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <ThemedCheckbox
              checked={skipConnectionTest}
              onChange={(event) => setSkipConnectionTest(event.target.checked)}
            />
            {t("skipCheck")}
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-accent to-purple-600 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? t("adding") : t("add")}
          </button>
        </form>
      )}

      {loading ? (
        <div className="glass rounded-2xl p-12 text-center text-gray-400">
          {t("loading")}
        </div>
      ) : accounts.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <div className="text-5xl mb-4">🤖</div>
          <h3 className="text-xl font-medium mb-2">{t("noBots")}</h3>
          <p className="text-gray-400 text-sm mb-6">{t("addBotDescription")}</p>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="px-6 py-2.5 rounded-xl bg-accent/20 text-accent-light font-medium hover:bg-accent/30"
          >
            {t("addFirstBot")}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="glass flex flex-col gap-4 rounded-xl p-4 glass-hover sm:flex-row sm:items-center sm:p-5"
            >
              <div
                className={`w-3 h-3 rounded-full flex-shrink-0 ${account.isActive ? "bg-green-400" : "bg-gray-600"}`}
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium">{account.name}</p>
                <p className="text-sm text-gray-400 break-words">
                  {account.botToken} · {t("channel")}: {account.channelId} ·{" "}
                  {account.filesCount} {t("files")}
                </p>
              </div>
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-shrink-0">
                <button
                  type="button"
                  onClick={() => void toggleAccount(account)}
                  className="w-full rounded-lg bg-white/5 px-3 py-1.5 text-sm transition-colors hover:bg-white/10 sm:w-auto"
                >
                  {account.isActive ? t("disable") : t("enable")}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteAccount(account)}
                  disabled={account.filesCount > 0}
                  title={account.filesCount > 0 ? t("waitCleanup") : undefined}
                  className="w-full rounded-lg bg-red-500/10 px-3 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
                >
                  {t("delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="glass rounded-2xl p-6">
        <h3 className="font-medium mb-4">{t("setupTitle")}</h3>
        <ol className="space-y-3 text-sm text-gray-400 list-decimal list-inside">
          <li>
            {t("setup1")}{" "}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-light hover:underline"
            >
              @BotFather
            </a>{" "}
            {t("setup1End")}
          </li>
          <li>{t("setup2")}</li>
          <li>{t("setup3")}</li>
          <li>
            {t("setup4")}{" "}
            <a
              href="https://t.me/userinfobot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-light hover:underline"
            >
              @userinfobot
            </a>{" "}
            {t("setup4Or")}{" "}
            <a
              href="https://t.me/RawDataBot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-light hover:underline"
            >
              @RawDataBot
            </a>
          </li>
          <li>{t("setup5")}</li>
        </ol>
      </div>
    </div>
  );
}
