import { expect, test } from "@playwright/test";
import { fulfillJson, mockAuth, mockUser } from "./helpers";

const transfer = {
  kind: "file" as const,
  token: "demo-token",
  name: "report.pdf",
  size: 2048,
  file_count: 1,
  expires_at: null,
  download_count: 2,
  max_downloads: 5,
  has_password: 1,
  storage_encrypted: 1,
  content_encryption: "none" as const,
  created_at: "2026-08-18T10:00:00.000Z",
  revoked_at: null,
  shareUrl: "http://127.0.0.1:3000/f/demo-token",
  canRecreateLink: true,
  expired: false,
  revoked: false,
};

test.describe("личный кабинет", () => {
  test("неавторизованный пользователь видит приглашение ко входу", async ({ page }) => {
    await mockAuth(page, null);
    await page.route("**/api/user/files**", (route) =>
      fulfillJson(route, { error: "Требуется авторизация" }, 401)
    );
    await page.route("**/api/user/stats", (route) => fulfillJson(route, {}));
    await page.route("**/api/user/notifications", (route) => fulfillJson(route, {}));

    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Личный кабинет" })).toBeVisible();
    await expect(page.getByText("Войдите, чтобы увидеть свои передачи.")).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Войти", exact: true })).toHaveAttribute(
      "href",
      "/login?next=/dashboard"
    );
  });

  test("авторизованный пользователь управляет передачей и уведомлениями", async ({ page }) => {
    await mockUser(page);

    let revoked = false;
    let deleted = false;
    let notifications = {
      email_enabled: 1,
      download_notifications: 1,
      summary_notifications: 0,
      expiry_warning_days: 7,
    };

    await page.route("**/api/user/files**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (request.method() === "GET") {
        await fulfillJson(route, {
          items: deleted ? [] : [{ ...transfer, revoked, revoked_at: revoked ? "2026-08-18T11:00:00.000Z" : null }],
          total: deleted ? 0 : 1,
          page: Number(url.searchParams.get("page") || 1),
          pageSize: 20,
        });
        return;
      }

      if (request.method() === "POST") {
        const action = url.searchParams.get("action");
        if (action === "revoke") revoked = true;
        if (action === "restore") revoked = false;
        await fulfillJson(route, { success: true });
        return;
      }

      if (request.method() === "PATCH") {
        await fulfillJson(route, { success: true });
        return;
      }

      if (request.method() === "DELETE") {
        deleted = true;
        await fulfillJson(route, { success: true });
        return;
      }

      await fulfillJson(route, {}, 405);
    });
    await page.route("**/api/user/stats", (route) =>
      fulfillJson(route, {
        transfers: 4,
        downloads: 8,
        recentDownloads: [{ file_name: "report.pdf", created_at: "2026-08-18", outcome: "ok" }],
      })
    );
    await page.route("**/api/user/notifications**", async (route) => {
      if (route.request().method() === "PATCH") {
        notifications = { ...notifications, ...route.request().postDataJSON() };
      }
      await fulfillJson(route, notifications);
    });

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Личный кабинет" })).toBeVisible();
    await expect(page.getByRole("link", { name: "user@example.com" })).toHaveAttribute(
      "href",
      "/profile"
    );
    await expect(page.getByText("report.pdf", { exact: true })).toBeVisible();
    await expect(page.getByText("Передач", { exact: true })).toBeVisible();

    const allNotifications = page.getByRole("checkbox", { name: "Все уведомления" });
    await allNotifications.click();
    await expect(allNotifications).not.toBeChecked();

    const statusSelect = page.getByRole("button", { name: "Фильтр по статусу" });
    await statusSelect.click();
    await page.getByRole("option", { name: "С паролем" }).click();
    await expect(statusSelect).toContainText("С паролем");

    await page.getByRole("button", { name: "Копировать", exact: true }).click();
    await expect(page.getByRole("button", { name: "Скопировано", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "QR", exact: true }).click();
    await expect(page.getByRole("heading", { name: "QR-код" })).toBeVisible();
    await expect(page.getByAltText("QR-код: report.pdf")).toBeVisible();
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();

    await expect(page.getByRole("button", { name: "Короткая", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Изменить", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Настройки ссылки" })).toBeVisible();
    await page.getByRole("button", { name: "Срок действия" }).click();
    await page.getByRole("option", { name: "7 дней" }).click();
    await page.locator('input[type="password"][placeholder="Оставить текущий"]').fill(
      "new-link-password"
    );
    await page.getByRole("checkbox", { name: "Убрать пароль" }).check();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Настройки ссылки" })).toBeHidden();

    await page.getByRole("button", { name: "Отозвать", exact: true }).click();
    await expect(page.getByRole("button", { name: "Восстановить", exact: true })).toBeVisible();

    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(page.getByText("Передач пока нет")).toBeVisible();
  });

  test("переключает страницы списка передач", async ({ page }) => {
    await mockUser(page);

    await page.route("**/api/user/files**", async (route) => {
      if (route.request().method() !== "GET") {
        await fulfillJson(route, {}, 405);
        return;
      }

      const currentPage = Number(new URL(route.request().url()).searchParams.get("page") || "1");
      await fulfillJson(route, {
        items: [{ ...transfer, token: `page-${currentPage}`, name: currentPage === 1 ? "page-one.pdf" : "page-two.pdf" }],
        total: 41,
        page: currentPage,
        pageSize: 20,
        totalPages: 3,
      });
    });
    await page.route("**/api/user/stats", (route) => fulfillJson(route, { transfers: 41, downloads: 0, recentDownloads: [] }));
    await page.route("**/api/user/notifications", (route) => fulfillJson(route, {
      email_enabled: 1,
      download_notifications: 1,
      summary_notifications: 1,
      expiry_warning_days: 7,
    }));

    await page.goto("/dashboard");
    await expect(page.getByText("page-one.pdf", { exact: true })).toBeVisible();
    await expect(page.getByText("Показано 1–20 из 41")).toBeVisible();

    await page.getByRole("button", { name: "Страница 2" }).click();
    await expect(page.getByText("page-two.pdf", { exact: true })).toBeVisible();
    await expect(page.getByText("Показано 21–40 из 41")).toBeVisible();
    await expect(page.getByRole("button", { name: "Предыдущая страница" })).toBeEnabled();
  });
});
