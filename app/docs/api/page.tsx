import type { Metadata } from "next";
import { getMessages, getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("docs");
  return { title: t("metadataTitle"), description: t("metadataDescription") };
}

type ParameterLocation = "path" | "query" | "header" | "body";

interface ApiParameter {
  name: string;
  location: ParameterLocation;
  type: string;
  required?: boolean;
  description: string;
}

interface ApiEndpoint {
  method: string;
  path: string;
  description: string;
  parameters: ApiParameter[];
}

interface ApiResponse {
  status: string;
  description: string;
  body: string;
  headers?: string;
}

const authorizationParameter: ApiParameter = {
  name: "Authorization",
  location: "header",
  type: "Bearer <API_KEY>",
  required: true,
  description:
    "API-ключ из профиля пользователя. Cookie-авторизация не используется.",
};

const expiryParameter: ApiParameter = {
  name: "expiry",
  location: "body",
  type: "1h | 24h | 7d | 30d | never",
  description: "Срок действия ссылки. По умолчанию never.",
};

const uploadSecurityParameters: ApiParameter[] = [
  {
    name: "password",
    location: "body",
    type: "string | null",
    description: "Пароль для скачивания, максимум 1024 символа.",
  },
  {
    name: "maxDownloads",
    location: "body",
    type: "integer | null",
    description: "Максимальное число скачиваний: от 1 до 1 000 000.",
  },
];

const paginationParameters: ApiParameter[] = [
  {
    name: "page",
    location: "query",
    type: "integer",
    description: "Номер страницы, начиная с 1. По умолчанию 1.",
  },
  {
    name: "pageSize",
    location: "query",
    type: "integer",
    description: "Размер страницы от 1 до 100. По умолчанию 20.",
  },
];

const endpoints: ApiEndpoint[] = [
  {
    method: "GET",
    path: "/me",
    description: "Текущий пользователь",
    parameters: [],
  },
  {
    method: "POST",
    path: "/groups",
    description: "Создать группу файлов",
    parameters: [expiryParameter, ...uploadSecurityParameters],
  },
  {
    method: "POST",
    path: "/uploads",
    description: "Загрузить файл multipart",
    parameters: [
      {
        name: "file",
        location: "body",
        type: "binary",
        required: true,
        description: "Файл для загрузки.",
      },
      expiryParameter,
      ...uploadSecurityParameters,
      {
        name: "groupToken",
        location: "body",
        type: "string",
        description: "Токен существующей группы файлов.",
      },
      {
        name: "contentEncryption",
        location: "body",
        type: "none | e2ee-v1",
        description:
          "Режим шифрования содержимого. Для E2EE используйте e2ee-v1; ключ добавляется в fragment ссылки после #.",
      },
      {
        name: "originalSize",
        location: "body",
        type: "integer",
        description: "Размер исходного файла в байтах; нужен для E2EE.",
      },
    ],
  },
  {
    method: "POST",
    path: "/upload-sessions",
    description: "Создать resumable-сессию",
    parameters: [
      {
        name: "fileName",
        location: "body",
        type: "string",
        required: true,
        description: "Имя файла, максимум 255 символов.",
      },
      {
        name: "mimeType",
        location: "body",
        type: "string",
        description:
          "MIME-тип файла, максимум 255 символов. По умолчанию application/octet-stream.",
      },
      {
        name: "totalSize",
        location: "body",
        type: "integer",
        required: true,
        description: "Размер передаваемого потока в байтах.",
      },
      {
        name: "originalSize",
        location: "body",
        type: "integer",
        description: "Размер исходного файла в байтах; обязателен для E2EE.",
      },
      {
        name: "checksum",
        location: "body",
        type: "SHA-256 hex",
        description: "Итоговая SHA-256 контрольная сумма файла.",
      },
      expiryParameter,
      ...uploadSecurityParameters,
      {
        name: "groupToken",
        location: "body",
        type: "string",
        description: "Токен существующей группы файлов.",
      },
      {
        name: "contentEncryption",
        location: "body",
        type: "none | e2ee-v1",
        description:
          "Режим шифрования содержимого. Для E2EE ключ добавляется в fragment ссылки после #.",
      },
    ],
  },
  {
    method: "GET",
    path: "/upload-sessions/{id}",
    description: "Получить состояние resumable-сессии",
    parameters: [
      {
        name: "id",
        location: "path",
        type: "string",
        required: true,
        description: "Идентификатор upload-сессии.",
      },
    ],
  },
  {
    method: "DELETE",
    path: "/upload-sessions/{id}",
    description: "Отменить resumable-сессию",
    parameters: [
      {
        name: "id",
        location: "path",
        type: "string",
        required: true,
        description: "Идентификатор upload-сессии.",
      },
    ],
  },
  {
    method: "PUT",
    path: "/upload-sessions/{id}/parts/{index}",
    description: "Загрузить часть файла",
    parameters: [
      {
        name: "id",
        location: "path",
        type: "string",
        required: true,
        description: "Идентификатор upload-сессии.",
      },
      {
        name: "index",
        location: "path",
        type: "integer",
        required: true,
        description: "Индекс части, начиная с 0.",
      },
      {
        name: "X-Chunk-SHA256",
        location: "header",
        type: "SHA-256 hex",
        required: true,
        description:
          "SHA-256 именно этой бинарной части: 64 hex-символа в нижнем регистре.",
      },
      {
        name: "binary body",
        location: "body",
        type: "application/octet-stream",
        required: true,
        description: "Содержимое части файла. Обычный размер части — 4 MiB.",
      },
    ],
  },
  {
    method: "POST",
    path: "/upload-sessions/{id}/complete",
    description: "Завершить загрузку",
    parameters: [
      {
        name: "id",
        location: "path",
        type: "string",
        required: true,
        description: "Идентификатор upload-сессии.",
      },
      {
        name: "checksum",
        location: "body",
        type: "SHA-256 hex",
        description: "Итоговая SHA-256 контрольная сумма всего файла.",
      },
    ],
  },
  {
    method: "GET",
    path: "/transfers",
    description: "Список своих передач",
    parameters: [
      ...paginationParameters,
      {
        name: "q",
        location: "query",
        type: "string",
        description: "Поиск по названию передачи.",
      },
      {
        name: "status",
        location: "query",
        type: "active | expired | revoked | password | e2ee",
        description: "Фильтр по статусу.",
      },
      {
        name: "kind",
        location: "query",
        type: "file | group",
        description: "Фильтр по типу передачи.",
      },
      {
        name: "sort",
        location: "query",
        type: "created | size | downloads",
        description: "Сортировка. По умолчанию created.",
      },
    ],
  },
  {
    method: "GET",
    path: "/transfers/{token}",
    description: "Получить детали передачи",
    parameters: [
      {
        name: "token",
        location: "path",
        type: "string",
        required: true,
        description: "Токен передачи из shareUrl.",
      },
    ],
  },
  {
    method: "PATCH",
    path: "/transfers/{token}",
    description: "Изменить настройки передачи",
    parameters: [
      {
        name: "token",
        location: "path",
        type: "string",
        required: true,
        description: "Токен передачи из shareUrl.",
      },
      {
        name: "expiry",
        location: "body",
        type: "keep | 1h | 24h | 7d | 30d | never",
        description: "Новый срок действия или keep, чтобы оставить текущий.",
      },
      {
        name: "expiresAt",
        location: "body",
        type: "ISO 8601 date-time | null",
        description: "Точная дата окончания; null снимает дату.",
      },
      {
        name: "password",
        location: "body",
        type: "string | null",
        description: "Новый пароль или null, чтобы убрать пароль.",
      },
      {
        name: "maxDownloads",
        location: "body",
        type: "integer | null",
        description: "Новый лимит скачиваний или null, чтобы убрать лимит.",
      },
    ],
  },
  {
    method: "DELETE",
    path: "/transfers/{token}",
    description: "Удалить передачу из FileShare и Telegram",
    parameters: [
      {
        name: "token",
        location: "path",
        type: "string",
        required: true,
        description: "Токен передачи из shareUrl.",
      },
    ],
  },
  {
    method: "POST",
    path: "/transfers/{token}/revoke",
    description: "Отозвать передачу",
    parameters: [
      {
        name: "token",
        location: "path",
        type: "string",
        required: true,
        description: "Токен передачи из shareUrl.",
      },
    ],
  },
  {
    method: "POST",
    path: "/transfers/{token}/restore",
    description: "Восстановить передачу",
    parameters: [
      {
        name: "token",
        location: "path",
        type: "string",
        required: true,
        description: "Токен передачи из shareUrl.",
      },
    ],
  },
  {
    method: "GET",
    path: "/stats",
    description: "Получить статистику пользователя",
    parameters: [],
  },
  {
    method: "GET",
    path: "/notifications",
    description: "Получить настройки уведомлений",
    parameters: [],
  },
  {
    method: "PATCH",
    path: "/notifications",
    description: "Изменить настройки уведомлений",
    parameters: [
      {
        name: "emailEnabled",
        location: "body",
        type: "boolean",
        description: "Включить уведомления по email.",
      },
      {
        name: "downloadNotifications",
        location: "body",
        type: "boolean",
        description: "Уведомлять о каждом скачивании.",
      },
      {
        name: "summaryNotifications",
        location: "body",
        type: "boolean",
        description: "Включить сводные уведомления.",
      },
      {
        name: "expiryWarningDays",
        location: "body",
        type: "integer 0..30",
        description: "За сколько дней предупреждать об окончании ссылки.",
      },
    ],
  },
];

const commonApiResponses: ApiResponse[] = [
  {
    status: "401",
    description: "API-ключ отсутствует или недействителен",
    body: '{ "error": { "code": "missing_api_key | invalid_api_key", "message": "..." } }',
    headers: "WWW-Authenticate: Bearer",
  },
  {
    status: "403",
    description: "Пользователь заблокирован",
    body: '{ "error": { "code": "user_blocked", "message": "Пользователь заблокирован" } }',
  },
];

const endpointResponses: Record<string, ApiResponse[]> = {
  "GET /me": [
    {
      status: "200",
      description: "Данные текущего пользователя",
      body: '{ "id": 123, "email": "user@example.com", "createdAt": "2026-08-20T10:00:00.000Z" }',
    },
  ],
  "POST /groups": [
    {
      status: "201",
      description: "Группа создана",
      body: '{ "token": "group-token", "shareUrl": "https://example.com/f/group-token", "expiresAt": null, "maxDownloads": 20, "hasPassword": false }',
    },
    {
      status: "400",
      description: "Некорректные параметры или превышен лимит скачиваний",
      body: '{ "error": { "code": "invalid_request | max_downloads_exceeded", "message": "..." } }',
    },
    {
      status: "429",
      description: "Превышен лимит активных ссылок",
      body: '{ "error": { "code": "active_link_limit_exceeded", "message": "..." } }',
    },
  ],
  "POST /uploads": [
    {
      status: "200",
      description: "Файл загружен",
      body: '{ "file": { "token": "file-token", "name": "report.pdf", "size": 2048, "mimeType": "application/pdf", "expiresAt": null, "maxDownloads": null, "hasPassword": false, "storageEncrypted": true, "contentEncryption": "none", "shareUrl": "https://example.com/f/file-token", "createdAt": "2026-08-20T10:00:00.000Z" } }',
    },
    {
      status: "400",
      description: "Ошибка валидации загрузки",
      body: '{ "error": { "code": "invalid_upload", "message": "..." } }',
    },
    {
      status: "429",
      description: "Сработал rate limit загрузок",
      body: '{ "error": { "code": "rate_limit_exceeded", "message": "..." } }',
      headers: "Retry-After: <seconds>",
    },
  ],
  "POST /upload-sessions": [
    {
      status: "201",
      description: "Resumable-сессия создана",
      body: '{ "sessionId": "session-id", "status": "active", "totalSize": 8388608, "chunkSize": 4194304, "totalChunks": 2, "uploadedParts": [] }',
    },
    {
      status: "400",
      description: "Некорректные параметры файла, checksum или E2EE-размер",
      body: '{ "error": { "code": "invalid_request", "message": "..." } }',
    },
    {
      status: "429",
      description: "Превышен лимит параллельных загрузок или активных ссылок",
      body: '{ "error": { "code": "parallel_upload_limit_exceeded | active_link_limit_exceeded", "message": "..." } }',
    },
  ],
  "GET /upload-sessions/{id}": [
    {
      status: "200",
      description: "Состояние сессии и загруженные части",
      body: '{ "sessionId": "session-id", "status": "active", "totalSize": 8388608, "chunkSize": 4194304, "totalChunks": 2, "uploadedParts": [{ "index": 0, "size": 4194304, "checksum": "..." }], "result": null }',
    },
    {
      status: "404",
      description: "Сессия не найдена или принадлежит другому пользователю",
      body: '{ "error": { "code": "session_not_found", "message": "Сессия не найдена" } }',
    },
  ],
  "DELETE /upload-sessions/{id}": [
    {
      status: "200",
      description: "Сессия отменена",
      body: '{ "success": true }',
    },
    {
      status: "404",
      description: "Сессия не найдена",
      body: '{ "error": { "code": "session_not_found", "message": "Сессия не найдена" } }',
    },
  ],
  "PUT /upload-sessions/{id}/parts/{index}": [
    {
      status: "200",
      description: "Часть принята или уже была загружена",
      body: '{ "success": true, "index": 0, "checksum": "...", "alreadyUploaded": false }',
    },
    {
      status: "400",
      description: "Некорректный индекс, размер, тело или checksum",
      body: '{ "error": { "code": "invalid_part_index | invalid_part_size | missing_part_body | missing_part_checksum", "message": "..." } }',
    },
    {
      status: "404",
      description: "Сессия недоступна",
      body: '{ "error": { "code": "session_not_found", "message": "Сессия недоступна" } }',
    },
    {
      status: "422",
      description: "Checksum части не совпадает с телом",
      body: '{ "error": { "code": "part_checksum_mismatch", "message": "Контрольная сумма части не совпадает" } }',
    },
  ],
  "POST /upload-sessions/{id}/complete": [
    {
      status: "200",
      description:
        "Загрузка завершена; при повторном вызове возвращается alreadyCompleted",
      body: '{ "success": true, "file": { "token": "file-token", "name": "report.pdf", "size": 2048, "shareUrl": "https://example.com/f/file-token", "contentEncryption": "none" }, "alreadyCompleted": false }',
    },
    {
      status: "404",
      description: "Сессия не найдена",
      body: '{ "error": { "code": "session_not_found", "message": "Сессия не найдена" } }',
    },
    {
      status: "409",
      description: "Не все части загружены или сессия уже обрабатывается",
      body: '{ "error": { "code": "missing_parts | session_unavailable", "message": "..." } }',
    },
    {
      status: "500",
      description: "Не удалось собрать или сохранить файл",
      body: '{ "error": { "code": "upload_completion_failed", "message": "..." } }',
    },
  ],
  "GET /transfers": [
    {
      status: "200",
      description: "Пагинированный список собственных передач",
      body: '{ "items": [{ "kind": "file", "token": "file-token", "name": "report.pdf", "size": 2048, "fileCount": 1, "expiresAt": null, "downloadCount": 0, "maxDownloads": null, "hasPassword": false, "storageEncrypted": true, "contentEncryption": "none", "createdAt": "2026-08-20T10:00:00.000Z", "revoked": false, "expired": false, "shareUrl": "https://example.com/f/file-token", "canRecreateLink": true }], "total": 1, "page": 1, "pageSize": 20, "totalPages": 1 }',
    },
  ],
  "GET /transfers/{token}": [
    {
      status: "200",
      description: "Детали передачи и файлы",
      body: '{ "kind": "file", "token": "file-token", "shareUrl": "https://example.com/f/file-token", "canRecreateLink": true, "group": null, "file": { "token": "file-token", "name": "report.pdf", "size": 2048, "mimeType": "application/pdf", "expiresAt": null, "downloadCount": 0, "maxDownloads": null, "hasPassword": false, "revoked": false, "storageEncrypted": true, "contentEncryption": "none", "createdAt": "2026-08-20T10:00:00.000Z" }, "files": [] }',
    },
    {
      status: "404",
      description: "Передача не найдена или не принадлежит пользователю",
      body: '{ "error": { "code": "transfer_not_found", "message": "Передача не найдена" } }',
    },
  ],
  "PATCH /transfers/{token}": [
    {
      status: "200",
      description: "Настройки передачи обновлены",
      body: '{ "success": true }',
    },
    {
      status: "400",
      description: "Некорректные данные или нет изменений",
      body: '{ "error": { "code": "invalid_request | no_changes | expiry_in_past | max_downloads_below_usage", "message": "..." } }',
    },
    {
      status: "404",
      description: "Передача не найдена",
      body: '{ "error": { "code": "transfer_not_found", "message": "Передача не найдена" } }',
    },
  ],
  "DELETE /transfers/{token}": [
    {
      status: "200",
      description: "Передача удалена из FileShare и Telegram",
      body: '{ "success": true }',
    },
    {
      status: "404",
      description: "Передача не найдена",
      body: '{ "error": { "code": "transfer_not_found", "message": "Передача не найдена" } }',
    },
    {
      status: "502",
      description: "Не удалось удалить сообщения из Telegram",
      body: '{ "error": { "code": "telegram_delete_failed", "message": "..." } }',
    },
  ],
  "POST /transfers/{token}/revoke": [
    {
      status: "200",
      description: "Передача отозвана",
      body: '{ "success": true, "revoked": true }',
    },
    {
      status: "404",
      description: "Передача не найдена",
      body: '{ "error": { "code": "transfer_not_found", "message": "Передача не найдена" } }',
    },
  ],
  "POST /transfers/{token}/restore": [
    {
      status: "200",
      description: "Передача восстановлена",
      body: '{ "success": true, "revoked": false }',
    },
    {
      status: "404",
      description: "Передача не найдена",
      body: '{ "error": { "code": "transfer_not_found", "message": "Передача не найдена" } }',
    },
  ],
  "GET /stats": [
    {
      status: "200",
      description: "Статистика пользователя",
      body: '{ "transfers": 12, "downloads": 48, "recentDownloads": [{ "fileName": "report.pdf", "token": "file-token", "outcome": "ok", "createdAt": "2026-08-20T10:00:00.000Z", "isGroupDownload": false }] }',
    },
  ],
  "GET /notifications": [
    {
      status: "200",
      description: "Текущие настройки уведомлений",
      body: '{ "emailEnabled": true, "downloadNotifications": true, "summaryNotifications": false, "expiryWarningDays": 7 }',
    },
  ],
  "PATCH /notifications": [
    {
      status: "200",
      description: "Настройки уведомлений обновлены",
      body: '{ "emailEnabled": true, "downloadNotifications": true, "summaryNotifications": false, "expiryWarningDays": 7 }',
    },
    {
      status: "400",
      description: "Некорректный период предупреждения или JSON",
      body: '{ "error": { "code": "invalid_expiry_warning_days | invalid_request", "message": "..." } }',
    },
  ],
};

function methodClass(method: string): string {
  if (method === "GET") return "text-emerald-300 bg-emerald-400/10";
  if (method === "POST") return "text-blue-300 bg-blue-400/10";
  if (method === "PATCH") return "text-amber-300 bg-amber-400/10";
  if (method === "PUT") return "text-purple-300 bg-purple-400/10";
  return "text-red-300 bg-red-400/10";
}

function parameterLocationLabel(location: ParameterLocation): string {
  if (location === "path") return "path";
  if (location === "query") return "query";
  if (location === "header") return "header";
  return "body";
}

const curlExample = [
  "curl https://your-domain.example/api/v1/me \\\\",
  "  -H 'Authorization: Bearer fs_live_...'",
].join("\n");

function createErrorExample(translate: (value: string) => string): string {
  return [
    "{",
    '  "error": {',
    '    "code": "invalid_api_key",',
    `    "message": "${translate("Недействительный API-ключ")}"`,
    "  }",
    "}",
  ].join("\n");
}

export default async function ApiDocsPage() {
  const t = await getTranslations("docs");
  const messages = await getMessages();
  const textEntries = Object.values(
    (messages.docs as {
      text?: Record<string, { source: string; value: string }>;
    }).text ?? {},
  );
  const textMessages = new Map(
    textEntries.map(({ source, value }) => [source, value]),
  );
  const translate = (value: string) => textMessages.get(value) ?? value;
  const translateBody = (value: string) =>
    Array.from(textMessages.entries()).reduce(
      (result, [source, target]) => result.replaceAll(source, target),
      value,
    );
  const errorExample = createErrorExample(translate);

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 animate-fade-in">
      <div className="mb-8">
        <p className="text-sm text-accent-light mb-2">{t("apiVersion")}</p>
        <h1 className="text-3xl sm:text-4xl font-bold">{t("apiTitle")}</h1>
        <p className="text-gray-400 mt-3 max-w-2xl">{t("apiIntro")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <main className="space-y-6">
          <section className="glass rounded-2xl p-5">
            <h2 className="text-xl font-semibold mb-3">
              {t("authentication")}
            </h2>
            <p className="text-gray-400 text-sm leading-6">
              {t("authenticationBody")}{" "}
              <code className="text-accent-light">
                Authorization: Bearer &lt;API_KEY&gt;
              </code>
              .
            </p>
            <pre className="api-code-block mt-4 overflow-x-auto rounded-xl p-4 text-sm">
              <code>{curlExample}</code>
            </pre>
          </section>

          <section className="glass rounded-2xl p-5">
            <h2 className="text-xl font-semibold mb-3">{t("baseUrl")}</h2>
            <code className="text-accent-light">
              https://your-domain.example/api/v1
            </code>
            <p className="text-gray-400 text-sm leading-6 mt-3">
              {t("baseUrlBody")}
            </p>
          </section>

          <section className="glass rounded-2xl p-5">
            <h2 className="text-xl font-semibold mb-4">{t("routes")}</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-gray-500">
                    <th className="py-2 pr-4">{t("method")}</th>
                    <th className="py-2 pr-4">{t("path")}</th>
                    <th className="py-2">{t("purpose")}</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map((endpoint) => (
                    <tr
                      key={`${endpoint.method}-${endpoint.path}`}
                      className="border-b border-white/5 last:border-0"
                    >
                      <td className="py-3 pr-4 font-mono text-accent-light whitespace-nowrap">
                        {endpoint.method}
                      </td>
                      <td className="api-path py-3 pr-4 font-mono whitespace-nowrap">
                        {endpoint.path}
                      </td>
                      <td className="py-3 text-gray-400">
                        {translate(endpoint.description)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="glass rounded-2xl p-5">
            <h2 className="text-xl font-semibold mb-2">
              {t("parametersTitle")}
            </h2>
            <p className="text-gray-400 text-sm leading-6 mb-5">
              {t("parametersIntro")}
            </p>
            <div className="space-y-4">
              {endpoints.map((endpoint, index) => {
                const parameters = [
                  authorizationParameter,
                  ...endpoint.parameters,
                ];
                const responses = [
                  ...(endpointResponses[
                    `${endpoint.method} ${endpoint.path}`
                  ] || []),
                  ...commonApiResponses,
                ];
                return (
                  <article
                    id={`api-method-${index}`}
                    key={`details-${endpoint.method}-${endpoint.path}`}
                    className="scroll-mt-24 rounded-xl border border-white/10 bg-surface-overlay p-4"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-1 font-mono text-xs font-semibold ${methodClass(endpoint.method)}`}
                        >
                          {endpoint.method}
                        </span>
                        <code className="api-path min-w-0 break-all text-sm">
                          {endpoint.path}
                        </code>
                      </div>
                      <span className="text-xs text-gray-500">
                        {translate(endpoint.description)}
                      </span>
                    </div>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[640px] text-left text-xs">
                        <thead className="text-gray-500">
                          <tr className="border-b border-white/10">
                            <th className="py-2 pr-3 font-medium">
                              {t("parameter")}
                            </th>
                            <th className="py-2 pr-3 font-medium">
                              {t("where")}
                            </th>
                            <th className="py-2 pr-3 font-medium">
                              {t("type")}
                            </th>
                            <th className="py-2 font-medium">
                              {t("description")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {parameters.map((parameter) => (
                            <tr
                              key={`${endpoint.method}-${endpoint.path}-${parameter.location}-${parameter.name}`}
                              className="border-b border-white/5 last:border-0 align-top"
                            >
                              <td className="py-2.5 pr-3 font-mono text-accent-light">
                                {parameter.name}
                                {parameter.required && (
                                  <span
                                    className="ml-1 text-red-300"
                                    title={t("requiredParameter")}
                                  >
                                    *
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 pr-3 whitespace-nowrap text-gray-400">
                                {parameterLocationLabel(parameter.location)}
                              </td>
                              <td className="py-2.5 pr-3 text-gray-300">
                                {parameter.type}
                              </td>
                              <td className="py-2.5 text-gray-400">
                                {translate(parameter.description)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4 border-t border-white/10 pt-3">
                      <h3 className="mb-2 text-sm font-medium text-gray-300">
                        {t("responses")}
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-left text-xs">
                          <thead className="text-gray-500">
                            <tr className="border-b border-white/10">
                              <th className="py-2 pr-3 font-medium">
                                {t("http")}
                              </th>
                              <th className="py-2 pr-3 font-medium">
                                {t("when")}
                              </th>
                              <th className="py-2 pr-3 font-medium">
                                {t("responseBody")}
                              </th>
                              <th className="py-2 font-medium">
                                {t("headers")}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {responses.map((response) => (
                              <tr
                                key={`${endpoint.method}-${endpoint.path}-${response.status}`}
                                className="border-b border-white/5 last:border-0 align-top"
                              >
                                <td className="py-2.5 pr-3 font-mono font-semibold text-accent-light">
                                  {response.status}
                                </td>
                                <td className="py-2.5 pr-3 text-gray-400">
                                  {translate(response.description)}
                                </td>
                                <td className="py-2.5 pr-3">
                                  <code className="block max-w-[520px] whitespace-pre-wrap break-words text-gray-300">
                                    {translateBody(response.body)}
                                  </code>
                                </td>
                                <td className="py-2.5 text-gray-400">
                                  {response.headers || t("jsonHeader")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            <p className="mt-4 text-xs text-gray-500">{t("requiredNote")}</p>
          </section>

          <section className="glass rounded-2xl p-5">
            <h2 className="text-xl font-semibold mb-3">{t("errors")}</h2>
            <pre className="api-error-code overflow-x-auto rounded-xl p-4 text-sm">
              <code>{errorExample}</code>
            </pre>
            <p className="text-gray-400 text-sm leading-6 mt-3">
              {t("errorsIntro")}
            </p>
          </section>
        </main>

        <aside className="order-first space-y-4 lg:sticky lg:top-24 lg:order-last lg:self-start">
          <div className="glass rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">{t("methods")}</h2>
              <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-gray-500">
                {endpoints.length}
              </span>
            </div>
            <nav
              aria-label={t("methodsNavAria")}
              className="mt-3 max-h-[65vh] space-y-1 overflow-y-auto pr-1"
            >
              {endpoints.map((endpoint, index) => (
                <a
                  key={`nav-${endpoint.method}-${endpoint.path}`}
                  href={`#api-method-${index}`}
                  className="flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors hover:bg-white/10"
                >
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${methodClass(endpoint.method)}`}
                  >
                    {endpoint.method}
                  </span>
                  <span className="min-w-0">
                    <code className="api-path block break-all">
                      {endpoint.path}
                    </code>
                    <span className="mt-0.5 block text-gray-500">
                      {translate(endpoint.description)}
                    </span>
                  </span>
                </a>
              ))}
            </nav>
          </div>
          <div className="glass rounded-2xl p-5">
            <h2 className="font-semibold mb-3">{t("specification")}</h2>
            <a
              href="/api/docs/openapi"
              className="text-sm text-accent-light hover:text-white"
            >
              {t("downloadOpenapi")}
            </a>
            <a
              href="/api/docs/markdown"
              className="block mt-2 text-sm text-gray-400 hover:text-white"
            >
              {t("downloadMarkdown")}
            </a>
          </div>
          <div className="glass rounded-2xl p-5 text-sm text-gray-400 leading-6">
            <h2 className="mb-2 font-semibold text-foreground">
              {t("e2eeTitle")}
            </h2>
            <p>{t("e2eeBody")}</p>
            <p className="mt-2">
              {t("e2eeFragment")} <code className="api-path">#</code>:
            </p>
            <code className="api-path mt-2 block break-all text-xs">
              https://your-domain.example/f/file-token#&lt;E2EE_KEY&gt;
            </code>
            <p className="mt-2 text-xs">{t("fragmentNote")}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
