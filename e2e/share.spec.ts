import { expect, test } from "@playwright/test";
import { fulfillJson } from "./helpers";

const secureFile = {
  kind: "file" as const,
  token: "secure-token",
  name: "secret.txt",
  size: 11,
  mimeType: "text/plain",
  storageEncrypted: true,
  contentEncryption: "none" as const,
  expiresAt: null,
  downloadCount: 0,
  maxDownloads: null,
  hasPassword: true,
  createdAt: "2026-08-18T10:00:00.000Z",
  expired: false,
  revoked: false,
  downloadsExceeded: false,
  available: true,
};

test("недоступная ссылка показывает понятную ошибку", async ({ page }) => {
  await page.route("**/api/files/missing-token", (route) =>
    fulfillJson(route, { error: "Ссылка не найдена" }, 404)
  );

  await page.goto("/f/missing-token");

  await expect(page.getByRole("heading", { name: "Файл недоступен" })).toBeVisible();
  await expect(page.getByText("Ссылка не найдена")).toBeVisible();
});

test("защищённая ссылка показывает сведения и ошибку пароля", async ({ page }) => {
  await page.route("**/api/files/secure-token", (route) => fulfillJson(route, secureFile));
  await page.route("**/api/files/secure-token/access", (route) =>
    fulfillJson(route, { error: "Неверный пароль" }, 401)
  );

  await page.goto("/f/secure-token");

  await expect(page.getByRole("heading", { name: "secret.txt" })).toBeVisible();
  await expect(page.getByText("🔒 Пароль")).toBeVisible();
  await page.getByPlaceholder("Введите пароль").fill("wrong-password");
  await page.getByRole("button", { name: "Скачать файл" }).click();
  await expect(page.getByText("Неверный пароль")).toBeVisible();
});

test("групповая ссылка показывает список файлов и скачивание архива", async ({ page }) => {
  await page.route("**/api/files/group-token", (route) =>
    fulfillJson(route, {
      kind: "group",
      token: "group-token",
      name: "Мои документы",
      size: 3072,
      expiresAt: null,
      downloadCount: 1,
      maxDownloads: 5,
      hasPassword: false,
      createdAt: "2026-08-18T10:00:00.000Z",
      expired: false,
      revoked: false,
      downloadsExceeded: false,
      available: true,
      files: [
        { token: "one", name: "one.txt", size: 1024, mimeType: "text/plain", storageEncrypted: false, contentEncryption: "none" },
        { token: "two", name: "two.pdf", size: 2048, mimeType: "application/pdf", storageEncrypted: true, contentEncryption: "none" },
      ],
    })
  );

  await page.goto("/f/group-token");

  await expect(page.getByRole("heading", { name: "Мои документы" })).toBeVisible();
  await expect(page.getByText("Файлы в ссылке")).toBeVisible();
  await expect(page.getByText("one.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("two.pdf", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Скачать", exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Скачать всё" })).toBeVisible();
});
