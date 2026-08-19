import { expect, test } from "@playwright/test";
import { fulfillJson, mockGuest } from "./helpers";

test("загрузка небольшого файла показывает очередь и готовую ссылку", async ({ page }) => {
  await mockGuest(page);
  await page.route("**/api/upload", (route) =>
    fulfillJson(route, {
      file: {
        token: "file-token",
        name: "hello.txt",
        size: 11,
        mimeType: "text/plain",
        shareUrl: "http://127.0.0.1:3000/f/file-token",
        expiresAt: null,
        hasPassword: false,
        storageEncrypted: true,
        contentEncryption: "none",
      },
    })
  );

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "hello.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello world"),
  });

  await expect(page.getByText("Ссылки на файлы (1)")).toBeVisible();
  await expect(page.getByText("hello.txt", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "QR", exact: true }).click();
  await expect(page.getByRole("heading", { name: "QR-код" })).toBeVisible();
  await expect(page.getByAltText("QR-код: hello.txt")).toBeVisible();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("button", { name: "Копировать", exact: true }).click();
  await expect(page.getByRole("button", { name: "Скопировано!", exact: true })).toBeVisible();
});
