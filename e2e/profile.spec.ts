import { expect, test } from "@playwright/test";
import { fulfillJson, mockAuth, mockUser } from "./helpers";

test.use({ locale: "ru" });

test.describe("профиль пользователя", () => {
  test("неавторизованный пользователь видит приглашение ко входу", async ({ page }) => {
    await mockAuth(page, null);
    await page.goto("/profile");

    await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();
    await expect(page.getByText("Войдите, чтобы управлять профилем и API-ключами.")).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Войти", exact: true })).toHaveAttribute(
      "href",
      "/login?next=/profile"
    );
  });

  test("создаёт, листает и отзывает API-ключи в профиле", async ({ page }) => {
    await mockUser(page);
    const keys = Array.from({ length: 11 }, (_, index) => ({
      id: index + 1,
      name: `Integration ${index + 1}`,
      prefix: `fs_live_prefix${index + 1}…`,
      lastUsedAt: null,
      createdAt: "2026-08-18T10:00:00.000Z",
    }));

    await page.route("**/api/user/api-keys**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "GET") {
        const pageNumber = Number(url.searchParams.get("page") || 1);
        await fulfillJson(route, {
          items: pageNumber === 1 ? keys.slice(0, 10) : keys.slice(10),
          total: keys.length,
          page: pageNumber,
          pageSize: 10,
          totalPages: 2,
        });
        return;
      }
      if (request.method() === "POST") {
        const created = {
          id: 99,
          name: request.postDataJSON().name,
          prefix: "fs_live_newkey…",
          lastUsedAt: null,
          createdAt: "2026-08-20T10:00:00.000Z",
        };
        keys.unshift(created);
        await fulfillJson(route, { key: created, secret: "fs_live_secret_only_once" }, 201);
        return;
      }
      if (request.method() === "DELETE") {
        const id = Number(url.pathname.split("/").pop());
        const index = keys.findIndex((key) => key.id === id);
        if (index >= 0) keys.splice(index, 1);
        await fulfillJson(route, { success: true });
        return;
      }
      await fulfillJson(route, {}, 405);
    });

    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();
    await expect(page.getByRole("main").getByText("user@example.com", { exact: true })).toBeVisible();
    await expect(page.getByText("Integration 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Показано 1–10 из 11").first()).toBeVisible();
    await expect(page.getByText("Показано 1–10 из 11")).toHaveCount(2);

    await page.getByRole("button", { name: "Следующая страница" }).first().click();
    await expect(page.getByText("Показано 11–11 из 11").first()).toBeVisible();
    await expect(page.getByText("Integration 11", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Предыдущая страница" }).first().click();
    await page.getByPlaceholder("Название интеграции").fill("New integration");
    await page.getByRole("button", { name: "Создать ключ" }).click();
    await expect(page.getByText("fs_live_secret_only_once")).toBeVisible();

    page.on("dialog", (dialog) => dialog.accept());
    await page.getByText("Integration 1", { exact: true }).locator("xpath=../../..").getByRole("button", { name: "Отозвать" }).click();
    await expect(page.getByText("Integration 1", { exact: true })).toHaveCount(0);
  });
});
