import UploadZone from "@/components/UploadZone";
import {
  getMaxFileSizeBytes,
  getMaxFileSizeLabel,
} from "@/lib/telegram-config";

export default function HomePage() {
  const maxFileSize = getMaxFileSizeBytes();
  const maxFileSizeLabel = getMaxFileSizeLabel();

  return (
    <div className="max-w-3xl mx-auto px-4 py-16 animate-fade-in">
      <div className="text-center mb-12">
        <h1 className="text-4xl sm:text-5xl font-bold mb-4">
          Безопасный обмен{" "}
          <span className="gradient-text">файлами</span>
        </h1>
        <p className="text-gray-400 text-lg max-w-xl mx-auto">
          Загружайте файлы пачкой, получайте ссылки для скачивания.
          Хранение в Telegram с ограничением доступа по времени.
        </p>
      </div>

      <UploadZone
        maxFileSize={maxFileSize}
        maxFileSizeLabel={maxFileSizeLabel}
      />
      <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6">
        {[
          {
            icon: "⚡",
            title: "Быстрая загрузка",
            desc: "Файлы мгновенно сохраняются в Telegram",
          },
          {
            icon: "🔒",
            title: "Контроль доступа",
            desc: "Ограничение по времени, паролю и числу скачиваний",
          },
          {
            icon: "☁️",
            title: "Надёжное хранение",
            desc: "Несколько Telegram-аккаунтов для резервирования",
          },
        ].map((feature) => (
          <div
            key={feature.title}
            className="glass rounded-xl p-6 text-center glass-hover"
          >
            <div className="text-3xl mb-3">{feature.icon}</div>
            <h3 className="font-medium mb-1">{feature.title}</h3>
            <p className="text-sm text-gray-400">{feature.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
