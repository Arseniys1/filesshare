import { expect, test } from "@playwright/test";
import { fulfillJson, mockAuth } from "./helpers";

const admin = { email: "admin@example.com", role: "admin" as const };

test.describe("админ-панель", () => {
  test("неавторизованный пользователь видит приглашение ко входу", async ({ page }) => {
    await mockAuth(page, null);
    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "Админ-панель" })).toBeVisible();
    await expect(page.getByText("Для доступа к панели войдите в аккаунт администратора.")).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Войти", exact: true })).toHaveAttribute(
      "href",
      "/login?next=/admin"
    );
  });

  test("обычный пользователь получает сообщение о недостатке прав", async ({ page }) => {
    await mockAuth(page, { email: "user@example.com", role: "user" });
    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: "Недостаточно прав" })).toBeVisible();
    await expect(page.getByText("Админ-панель доступна только пользователям с ролью администратора.")).toBeVisible();
  });

  test("администратор видит разделы и управляет ботом, пользователем и файлом", async ({ page }) => {
    await mockAuth(page, admin);

    let accountActive = true;
    let accountDeleted = false;
    let userRole: "user" | "admin" = "user";
    let fileRevoked = false;
    let fileDeleted = false;

    await page.route("**/api/admin/accounts**", async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        await fulfillJson(route, {
          accounts: accountDeleted ? [] : [{
            id: 1,
            name: "Основной бот",
            channelId: "-1001234567890",
            isActive: accountActive,
            filesCount: 0,
            createdAt: "2026-08-18T10:00:00.000Z",
            botToken: "123456789:ABCDEF",
          }],
          stats: { totalFiles: 12, totalSize: 2048, activeAccounts: accountActive ? 1 : 0, expiredFiles: 2 },
        });
        return;
      }
      if (request.method() === "POST") {
        await fulfillJson(route, { account: { id: 2 } }, 201);
        return;
      }
      if (request.method() === "PATCH") {
        accountActive = Boolean(request.postDataJSON().isActive);
        await fulfillJson(route, { success: true });
        return;
      }
      if (request.method() === "DELETE") {
        accountDeleted = true;
        await fulfillJson(route, { success: true });
        return;
      }
      await fulfillJson(route, {}, 405);
    });
    await page.route("**/api/admin/users**", async (route) => {
      if (route.request().method() === "PATCH") {
        userRole = route.request().postDataJSON().role || userRole;
        await fulfillJson(route, { success: true });
        return;
      }
      await fulfillJson(route, {
        users: [{
          id: 2,
          email: "user@example.com",
          role: userRole,
          blocked_at: null,
          max_file_size: null,
          storage_limit: null,
          active_link_limit: null,
          max_downloads: null,
          max_parallel_uploads: null,
          files_count: 2,
          storage_used: 1024,
          created_at: "2026-08-18T10:00:00.000Z",
        }],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });
    await page.route("**/api/admin/files**", async (route) => {
      const request = route.request();
      if (request.method() === "PATCH") {
        fileRevoked = request.postDataJSON().action === "revoke";
        await fulfillJson(route, { success: true, revoked: fileRevoked });
        return;
      }
      if (request.method() === "DELETE") {
        fileDeleted = true;
        await fulfillJson(route, { success: true });
        return;
      }
      await fulfillJson(route, {
        files: fileDeleted ? [] : [{
          token: "file-token",
          original_name: "report.pdf",
          size: 2048,
          mime_type: "application/pdf",
          owner_email: "user@example.com",
          group_token: null,
          expires_at: null,
          download_count: 3,
          max_downloads: null,
          revoked_at: fileRevoked ? "2026-08-18T11:00:00.000Z" : null,
          content_encryption: "none",
          created_at: "2026-08-18T10:00:00.000Z",
        }],
        page: 1,
        limit: 20,
        total: fileDeleted ? 0 : 1,
        totalPages: 1,
      });
    });
    await page.route("**/api/admin/audit**", (route) =>
      fulfillJson(route, {
        events: [{
          id: 1,
          admin_email: "admin@example.com",
          action: "account.create",
          target_type: "storage_account",
          target_id: "1",
          created_at: "2026-08-18 10:00:00",
        }],
      })
    );

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Админ-панель" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Пользователи/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Файлы/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Telegram-боты/ }).first()).toBeVisible();
    await expect(page.getByText("Последние действия")).toBeVisible();

    await page.goto("/admin/bots");
    await expect(page.getByRole("heading", { name: "Telegram-боты" })).toBeVisible();
    await expect(page.getByText("Основной бот", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "+ Добавить бота" }).click();
    await page.getByPlaceholder("Основной бот").fill("Резервный бот");
    await page.getByPlaceholder("-1001234567890").fill("-1009876543210");
    await page.getByPlaceholder("123456789:ABCdefGHIjklMNOpqrsTUVwxyz").fill("987654321:XYZ");
    await page.getByRole("checkbox", { name: "Пропустить проверку подключения к Telegram" }).check();
    await page.getByRole("button", { name: "Добавить", exact: true }).click();
    await expect(page.getByText("Бот успешно добавлен")).toBeVisible();

    await page.getByRole("button", { name: "Выключить", exact: true }).click();
    await expect(page.getByRole("button", { name: "Включить", exact: true })).toBeVisible();

    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Пользователи" })).toBeVisible();
    const roleSelect = page.getByRole("button", { name: "Роль пользователя user@example.com" });
    await roleSelect.click();
    await page.getByRole("option", { name: "Администратор" }).click();
    await expect(page.getByText("Настройки пользователя обновлены")).toBeVisible();

    await page.goto("/admin/files");
    await expect(page.getByRole("heading", { name: "Файлы" })).toBeVisible();
    await page.getByRole("button", { name: "Отозвать", exact: true }).click();
    await expect(page.getByRole("button", { name: "Восстановить", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Восстановить", exact: true }).click();
    await expect(page.getByRole("button", { name: "Отозвать", exact: true })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Удалить файл", exact: true }).click();
    await expect(page.getByText("Файлы не найдены")).toBeVisible();

    await page.goto("/admin/bots");
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(page.getByText("Нет подключенных ботов")).toBeVisible();
  });
});
