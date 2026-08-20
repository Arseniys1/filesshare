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

Основные статусы: \`400\` — некорректные данные, \`401\` — отсутствует или неверен ключ, \`403\` — пользователь заблокирован, \`404\` — объект не найден, \`409\` — конфликт состояния, \`422\` — ошибка контрольной суммы, \`429\` — превышен лимит, \`502\` — ошибка удаления из Telegram.

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
