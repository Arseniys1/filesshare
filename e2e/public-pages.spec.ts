import { expect, test } from "@playwright/test";

test.describe("публичные страницы", () => {
  test("главная страница показывает описание сервиса и навигацию", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("FileShare — Безопасный обмен файлами");
    await expect(
      page.getByRole("heading", { name: "Безопасный обмен файлами" })
    ).toBeVisible();
    await expect(page.getByText("Быстрая загрузка")).toBeVisible();
    await expect(page.getByRole("link", { name: "Войти" })).toHaveAttribute(
      "href",
      "/login"
    );
    await expect(page.getByRole("link", { name: "Регистрация" })).toHaveAttribute(
      "href",
      "/register"
    );
  });

  test("страница входа содержит доступную форму", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("type", "email");
    await expect(page.getByLabel("Пароль")).toHaveAttribute("type", "password");
    await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();
  });

  test("страница регистрации содержит поля подтверждения пароля", async ({ page }) => {
    await page.goto("/register");

    await expect(page.getByRole("heading", { name: "Регистрация" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");
    await expect(page.getByLabel("Пароль", { exact: true })).toHaveAttribute(
      "minlength",
      "8"
    );
    await expect(page.getByLabel("Повторите пароль")).toHaveAttribute(
      "minlength",
      "8"
    );
    await expect(
      page.getByRole("button", { name: "Зарегистрироваться" })
    ).toBeVisible();
  });
});
