import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import AuthNav from "@/components/AuthNav";
import ThemeToggle from "@/components/ThemeToggle";

const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem("filesshare-theme");
    var mode = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    var isDark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("light", !isDark);
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  } catch (_) {}
})();
`;

export const metadata: Metadata = {
  title: "FileShare — Безопасный обмен файлами",
  description:
    "Безопасная загрузка и обмен файлами с ограничением доступа по времени",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
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
              <nav className="flex items-center gap-1 sm:gap-4">
                <AuthNav />
              </nav>
            </div>
          </header>
          <main className="pt-16">{children}</main>
          <ThemeToggle />
        </div>
      </body>
    </html>
  );
}
