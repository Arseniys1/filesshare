import { expect, test } from "@playwright/test";
import { mockGuest } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockGuest(page);
});

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
    await expect(page.getByRole("link", { name: "API" })).toHaveAttribute(
      "href",
      "/docs/api"
    );
  });

  test("страница документации API доступна из шапки", async ({ page }) => {
    await page.goto("/docs/api");

    await expect(page.getByRole("heading", { name: "Документация API" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Параметры методов" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ответы" })).toHaveCount(17);
    const apiNavigation = page.getByRole("navigation", { name: "Навигация по методам API" });
    await expect(apiNavigation).toBeVisible();
    await expect(apiNavigation.getByRole("link")).toHaveCount(17);
    await expect(apiNavigation.getByRole("link").first()).toHaveAttribute("href", "#api-method-0");
    await expect(page.getByText("X-Chunk-SHA256", { exact: false })).toBeVisible();
    await expect(page.getByText("expiryWarningDays", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "E2EE-ссылки" })).toBeVisible();
    await expect(page.getByText("https://your-domain.example/f/file-token#<E2EE_KEY>", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Скачать OpenAPI YAML" })).toHaveAttribute(
      "href",
      "/api/docs/openapi"
    );

    await page.getByRole("button", { name: "Выбрать тему оформления" }).click();
    await page.getByRole("menuitemradio", { name: "Светлая" }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
    await expect(page.locator("pre.api-code-block").first()).toHaveCSS("background-color", "rgb(238, 242, 246)");
    await expect(page.locator("pre.api-error-code").first()).toHaveCSS("background-color", "rgb(255, 241, 242)");
    await expect(page.locator("code.api-path").first()).toHaveCSS("color", "rgb(29, 41, 57)");
  });

  test("главная страница позволяет настроить ссылку и тему оформления", async ({ page }) => {
    await page.goto("/");

    const individualLink = page.getByRole("radio", { name: /Отдельная ссылка/ });
    await individualLink.click();
    await expect(individualLink).toHaveAttribute("aria-checked", "true");

    const expirySelect = page.getByRole("button", { name: "Срок действия ссылки" });
    await expirySelect.click();
    await page.getByRole("option", { name: "7 дней" }).click();
    await expect(expirySelect).toContainText("7 дней");

    await page.getByPlaceholder("Защитить паролем").fill("upload-password");
    await page.getByPlaceholder("Без ограничения").fill("3");
    const e2ee = page.getByRole("checkbox");
    await e2ee.check();
    await expect(page.getByText("Включено")).toBeVisible();

    await page.getByRole("button", { name: "Выбрать тему оформления" }).click();
    await expect(page.getByRole("menu", { name: "Тема оформления" })).toBeVisible();
    await page.getByRole("menuitemradio", { name: "Тёмная" }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.themeMode)).toBe(
      "dark"
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
