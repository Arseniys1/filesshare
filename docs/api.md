# FileShare User API

Версия API: \`v1\`  
Базовый URL: \`https://your-domain.example/api/v1\`

OpenAPI-спецификация находится в [\`docs/openapi.yaml\`](./openapi.yaml).

## Аутентификация

API-ключ создаётся в профиле пользователя \`/profile\` (открывается по ссылке с email в шапке). Секрет показывается только один раз.
В профиле отображаются только активные ключи; при большом количестве список разбит на страницы.

Передавайте ключ в каждом запросе:

\`\`\`http
Authorization: Bearer fs_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
\`\`\`

Ключи нельзя передавать в query string, cookies или логировать. Отозванный ключ сразу перестаёт работать. Административные маршруты через API-ключ недоступны.

Пример проверки ключа:

\`\`\`bash
curl https://your-domain.example/api/v1/me \\
  -H 'Authorization: Bearer fs_live_...'
\`\`\`

## Ответы и ошибки

Успешные ответы возвращают JSON. Ошибка имеет вид:

\`\`\`json
{
  "error": {
    "code": "invalid_api_key",
    "message": "Недействительный API-ключ"
  }
}
\`\`\`

Основные статусы: \`400\` — некорректные данные, \`401\` — отсутствует или неверен ключ, \`403\` — пользователь заблокирован, \`404\` — объект не найден, \`409\` — конфликт состояния, \`422\` — ошибка контрольной суммы, \`429\` — превышен лимит, \`500\` — внутренняя ошибка, \`502\` — ошибка удаления из Telegram, \`503\` — хранилище недоступно.

## Полный справочник методов, параметров и ответов

Во всех методах обязателен заголовок `Authorization: Bearer <API_KEY>`. JSON-методы принимают `Content-Type: application/json`, обычная загрузка — `multipart/form-data`, загрузка части — `application/octet-stream`.

| Метод | Параметры запроса | Успешный ответ | Возможные ошибки |
| --- | --- | --- | --- |
| `GET /me` | нет | `200`: `id`, `email`, `createdAt` | `401`, `403` |
| `POST /groups` | JSON: `expiry`, `password`, `maxDownloads` | `201`: `token`, `shareUrl`, `expiresAt`, `maxDownloads`, `hasPassword` | `400`, `401`, `403`, `429` |
| `POST /uploads` | multipart: обязательный `file`; `expiry`, `password`, `maxDownloads`, `groupToken`, `contentEncryption` (`none`/`e2ee-v1`), `originalSize` | `200`: объект `file` с `token`, `name`, `size`, `mimeType`, `shareUrl`, настройками срока, пароля и шифрования | `400`, `401`, `403`, `429` (`Retry-After`), `500`, `503` |
| `POST /upload-sessions` | JSON: обязательные `fileName`, `totalSize`; `mimeType`, `originalSize`, `checksum`, `expiry`, `password`, `maxDownloads`, `groupToken`, `contentEncryption` | `201`: `sessionId`, `status`, `totalSize`, `chunkSize`, `totalChunks`, `uploadedParts` | `400`, `401`, `403`, `429`, `503` |
| `GET /upload-sessions/{id}` | path: `id` | `200`: состояние сессии, `uploadedParts`, `result` | `401`, `403`, `404` |
| `DELETE /upload-sessions/{id}` | path: `id` | `200`: `{ "success": true }` | `401`, `403`, `404` |
| `PUT /upload-sessions/{id}/parts/{index}` | path: `id`, `index`; header: обязательный `X-Chunk-SHA256`; binary body | `200`: `success`, `index`, `checksum`, возможно `alreadyUploaded` | `400`, `401`, `403`, `404`, `422`, `500` |
| `POST /upload-sessions/{id}/complete` | path: `id`; JSON: необязательный `checksum` | `200`: `success`, `file`, возможно `alreadyCompleted` | `401`, `403`, `404`, `409`, `500` |
| `GET /transfers` | query: `page`, `pageSize`, `q`, `status`, `kind`, `sort` | `200`: `items`, `total`, `page`, `pageSize`, `totalPages` | `401`, `403` |
| `GET /transfers/{token}` | path: `token` | `200`: `kind`, `token`, `shareUrl`, `group`, `file`, `files`, `canRecreateLink` | `401`, `403`, `404` |
| `PATCH /transfers/{token}` | path: `token`; JSON: `expiry`, `expiresAt`, `password`, `maxDownloads` | `200`: `{ "success": true }` | `400`, `401`, `403`, `404` |
| `DELETE /transfers/{token}` | path: `token` | `200`: `{ "success": true }` | `401`, `403`, `404`, `502` |
| `POST /transfers/{token}/revoke` | path: `token` | `200`: `{ "success": true, "revoked": true }` | `401`, `403`, `404` |
| `POST /transfers/{token}/restore` | path: `token` | `200`: `{ "success": true, "revoked": false }` | `401`, `403`, `404` |
| `GET /stats` | нет | `200`: `transfers`, `downloads`, `recentDownloads` | `401`, `403` |
| `GET /notifications` | нет | `200`: `emailEnabled`, `downloadNotifications`, `summaryNotifications`, `expiryWarningDays` | `401`, `403` |
| `PATCH /notifications` | JSON: `emailEnabled`, `downloadNotifications`, `summaryNotifications`, `expiryWarningDays` (`0`–`30`) | `200`: обновлённые настройки уведомлений | `400`, `401`, `403` |

Ошибки имеют единый формат `{ "error": { "code": "...", "message": "..." } }`. Подробные JSON-схемы ответов доступны в [OpenAPI-спецификации](./openapi.yaml).

## Загрузка файла

Для небольших файлов можно использовать multipart-загрузку:

\`\`\`bash
curl -X POST https://your-domain.example/api/v1/uploads \\
  -H 'Authorization: Bearer fs_live_...' \\
  -F 'file=@./report.pdf' \\
  -F 'expiry=7d' \\
  -F 'password=secret' \\
  -F 'maxDownloads=10'
\`\`\`

Поддерживаемые поля: \`file\`, \`expiry\` (\`1h\`, \`24h\`, \`7d\`, \`30d\`, \`never\`), \`password\`, \`maxDownloads\`, \`groupToken\`, \`contentEncryption\` и \`originalSize\` для E2EE.

Для больших файлов используйте resumable-протокол:

1. \`POST /upload-sessions\` с \`fileName\`, \`mimeType\`, \`totalSize\`, \`expiry\` и дополнительными параметрами.
2. Для каждой части выполните \`PUT /upload-sessions/{id}/parts/{index}\` с бинарным телом и заголовком \`X-Chunk-SHA256\`.
3. Передайте итоговую SHA-256 в \`POST /upload-sessions/{id}/complete\`.
4. При сбое используйте \`GET /upload-sessions/{id}\` и продолжите только отсутствующие части.

Размер обычной части — \`4 MiB\`. API-ключ передаётся в каждом запросе; cookies для resumable-сессии не нужны.

### E2EE

При \`contentEncryption=e2ee-v1\` сервер получает только зашифрованные данные. Укажите \`originalSize\`, а \`totalSize\` должен совпадать с размером E2EE-потока. Ключ шифрования генерируется и хранится на стороне клиента; сервер не может восстановить его. Вернувшийся \`shareUrl\` нужно дополнить ключом во fragment URL по протоколу клиента FileShare.

## Группы файлов

Создайте группу:

\`\`\`bash
curl -X POST https://your-domain.example/api/v1/groups \\
  -H 'Authorization: Bearer fs_live_...' \\
  -H 'Content-Type: application/json' \\
  -d '{"expiry":"30d","maxDownloads":20}'
\`\`\`

Затем передавайте возвращённый \`token\` как \`groupToken\` при загрузке каждого файла.

## Передачи

| Метод | Путь | Назначение |
| --- | --- | --- |
| \`GET\` | \`/transfers\` | Список своих передач: \`q\`, \`status\`, \`kind\`, \`sort\`, \`page\`, \`pageSize\` |
| \`GET\` | \`/transfers/{token}\` | Детали передачи и список файлов |
| \`PATCH\` | \`/transfers/{token}\` | Изменить \`expiry\`/ \`expiresAt\`, \`password\`, \`maxDownloads\` |
| \`POST\` | \`/transfers/{token}/revoke\` | Отозвать ссылку |
| \`POST\` | \`/transfers/{token}/restore\` | Восстановить ссылку |
| \`DELETE\` | \`/transfers/{token}\` | Удалить передачу из Telegram и FileShare |

API возвращает \`shareUrl\`. Скачивание выполняется через существующую публичную ссылку \`/f/{token}\`; отдельный API-key-only download endpoint отсутствует.

## Статистика и уведомления

- \`GET /me\` — текущий пользователь.
- \`GET /stats\` — количество передач, скачиваний и последние события.
- \`GET /notifications\` — текущие настройки уведомлений.
- \`PATCH /notifications\` — изменить \`emailEnabled\`, \`downloadNotifications\`, \`summaryNotifications\`, \`expiryWarningDays\`.

## Лимиты и безопасность

API сохраняет индивидуальные лимиты пользователя, лимит активных ссылок, размер хранилища, лимит скачиваний, параллельные загрузки и существующий rate limit загрузок. При ответе \`429\` учитывайте заголовок \`Retry-After\`.

Секрет API-ключа нельзя восстановить после закрытия окна создания. Создайте новый ключ и отзовите старый, если он потерян или скомпрометирован.
