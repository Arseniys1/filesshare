import UploadZone from "@/components/UploadZone";
import {
  getMaxFileSizeBytes,
  getMaxFileSizeLabel,
} from "@/lib/telegram-config";

export default function HomePage() {
  const maxFileSize = getMaxFileSizeBytes();
  const maxFileSizeLabel = getMaxFileSizeLabel();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 animate-fade-in sm:py-16">
      <div className="mb-10 text-center sm:mb-12">
        <h1 className="mb-4 text-4xl font-bold leading-tight sm:text-5xl">
          Безопасный обмен{" "}
          <span className="gradient-text">файлами</span>
        </h1>
        <p className="mx-auto max-w-xl text-base leading-7 text-gray-400 sm:text-lg">
          Загружайте файлы пачкой и получайте одну общую ссылку.
          Каждый файл можно скачать отдельно или получить всё сразу.
          Защищённое хранение с ограничением доступа по времени.
        </p>
      </div>

      <UploadZone
        maxFileSize={maxFileSize}
        maxFileSizeLabel={maxFileSizeLabel}
      />
      <div className="mt-12 grid grid-cols-1 gap-4 sm:mt-16 sm:grid-cols-3 sm:gap-6">
        {[
          {
            icon: "⚡",
            title: "Быстрая загрузка",
            desc: "Файлы быстро сохраняются в защищённое хранилище",
          },
          {
            icon: "🔒",
            title: "Контроль доступа",
            desc: "Ограничение по времени, паролю и числу скачиваний",
          },
          {
            icon: "☁️",
            title: "Надёжное хранение",
            desc: "Файлы доступны по ссылке с заданными ограничениями",
          },
        ].map((feature) => (
          <div
            key={feature.title}
            className="glass rounded-xl p-5 text-center glass-hover sm:p-6"
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
