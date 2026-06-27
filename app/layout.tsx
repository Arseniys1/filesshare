import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "FileShare — Обмен файлами через Telegram",
  description:
    "Безопасная загрузка и обмен файлами с ограничением доступа по времени",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body className="font-sans antialiased">
        <div className="min-h-screen bg-grid bg-glow">
          <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/5">
            <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2 group">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white font-bold text-sm group-hover:scale-110 transition-transform">
                  FS
                </div>
                <span className="font-semibold text-lg">
                  File<span className="gradient-text">Share</span>
                </span>
              </Link>
              <nav className="flex items-center gap-4">
                <Link
                  href="/admin"
                  className="text-sm text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
                >
                  Админ
                </Link>
              </nav>
            </div>
          </header>
          <main className="pt-16">{children}</main>
        </div>
      </body>
    </html>
  );
}
