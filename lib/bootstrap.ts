import crypto from "node:crypto";

export function isValidBootstrapToken(value: unknown): boolean {
  const expected = process.env.BOOTSTRAP_ADMIN_TOKEN?.trim();
  const actual = typeof value === "string" ? value.trim() : "";
  if (!expected || !actual) return false;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}
