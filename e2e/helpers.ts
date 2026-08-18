import type { Page, Route } from "@playwright/test";

export interface TestUser {
  email: string;
  role: "user" | "admin";
}

export async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200
): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export async function mockAuth(page: Page, user: TestUser | null): Promise<void> {
  await page.route("**/api/auth/me", (route) => fulfillJson(route, { user }));
}

export async function mockGuest(page: Page): Promise<void> {
  await mockAuth(page, null);
}

export async function mockUser(
  page: Page,
  role: TestUser["role"] = "user"
): Promise<void> {
  await mockAuth(page, { email: `${role}@example.com`, role });
}
