import { expect, test } from "@playwright/test";
import { fulfillJson, mockGuest } from "./helpers";

test.describe("аутентификация", () => {
  test("вход показывает ошибку сервера для неверных данных", async ({ page }) => {
    await mockGuest(page);
    await page.route("**/api/auth/login", (route) =>
      fulfillJson(route, { error: "Неверный email или пароль" }, 401)
    );

    await page.goto("/login");
    await page.getByLabel("Email").fill("wrong@example.com");
    await page.getByLabel("Пароль").fill("wrong-password");
    await page.getByRole("button", { name: "Войти", exact: true }).click();

    await expect(page.getByText("Неверный email или пароль")).toBeVisible();
  });

  test("успешный вход обновляет навигацию пользователя", async ({ page }) => {
    let currentUser: { email: string; role: "user" } | null = null;
    await page.route("**/api/auth/me", (route) => fulfillJson(route, { user: currentUser }));
    await page.route("**/api/auth/login", async (route) => {
      currentUser = { email: "user@example.com", role: "user" };
      await fulfillJson(route, { user: currentUser });
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill("user@example.com");
    await page.getByLabel("Пароль").fill("correct-password");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.waitForURL("http://127.0.0.1:3000/");
    await expect(page.getByText("user@example.com")).toBeVisible();
    await expect(page.getByRole("link", { name: "Мои файлы" })).toHaveAttribute(
      "href",
      "/dashboard"
    );

    await page.route("**/api/auth/logout", async (route) => {
      currentUser = null;
      await fulfillJson(route, { success: true });
    });
    await page.getByRole("button", { name: "Выйти" }).click();
    await page.waitForURL("http://127.0.0.1:3000/");
    await expect(page.getByRole("link", { name: "Войти", exact: true })).toBeVisible();
  });

  test("регистрация показывает ошибку API", async ({ page }) => {
    await mockGuest(page);
    await page.route("**/api/auth/register", (route) =>
      fulfillJson(route, { error: "Пользователь уже зарегистрирован" }, 409)
    );

    await page.goto("/register");
    await page.getByLabel("Email").fill("existing@example.com");
    await page.getByLabel("Пароль", { exact: true }).fill("password-123");
    await page.getByLabel("Повторите пароль").fill("password-123");
    await page.getByRole("button", { name: "Зарегистрироваться" }).click();

    await expect(page.getByText("Пользователь уже зарегистрирован")).toBeVisible();
  });

  test("восстановление пароля показывает dev-ссылку", async ({ page }) => {
    await mockGuest(page);
    await page.route("**/api/auth/forgot-password", (route) =>
      fulfillJson(route, {
        message: "Если аккаунт существует, ссылка отправлена",
        resetUrl: "/reset-password?token=test-token",
      })
    );

    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: "Восстановление пароля" })).toBeVisible();
    await page.getByPlaceholder("you@example.com").fill("user@example.com");
    await page.getByRole("button", { name: "Отправить ссылку" }).click();

    await expect(page.getByText("Если аккаунт существует, ссылка отправлена")).toBeVisible();
    await expect(page.getByRole("link", { name: "открыть восстановление" })).toHaveAttribute(
      "href",
      "/reset-password?token=test-token"
    );
  });

  test("страница нового пароля обрабатывает успешную смену", async ({ page }) => {
    await mockGuest(page);
    await page.route("**/api/auth/reset-password", (route) =>
      fulfillJson(route, { success: true })
    );

    await page.goto("/reset-password?token=test-token");
    const passwords = page.locator('input[type="password"]');
    await passwords.nth(0).fill("new-password");
    await passwords.nth(1).fill("new-password");
    await page.getByRole("button", { name: "Сохранить пароль" }).click();

    await expect(page.getByText("Пароль изменён. Теперь можно войти.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Перейти ко входу" })).toHaveAttribute(
      "href",
      "/login"
    );
  });

  test("пустой токен блокирует смену пароля", async ({ page }) => {
    await mockGuest(page);
    await page.goto("/reset-password");

    await expect(page.getByText("В ссылке отсутствует токен восстановления.")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole("button", { name: "Сохранить пароль" })).toBeDisabled();
  });
});
