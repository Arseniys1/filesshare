import { describe, expect, it } from "vitest";
import {
  createDownloadGrant,
  verifyDownloadGrant,
} from "@/lib/download-grant";
import { hashPassword, verifyPassword } from "@/lib/utils";
import { isValidBootstrapToken } from "@/lib/bootstrap";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

describe("password migration", () => {
  it("stores new passwords with salted scrypt", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^scrypt\$/);
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
    await expect(verifyPassword("wrong", hash)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it("accepts a legacy SHA-256 hash once and marks it for upgrade", async () => {
    const legacy = "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b";
    await expect(verifyPassword("secret", legacy)).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
  });
});

describe("download grants", () => {
  it("verifies a grant only for the matching token", () => {
    const token = "Abcdef123456";
    const grant = createDownloadGrant(token);
    expect(verifyDownloadGrant(token, grant.value)).toBe(true);
    expect(verifyDownloadGrant("Zbcdef123456", grant.value)).toBe(false);
  });
});

describe("request hardening", () => {
  it("compares the production bootstrap token safely", () => {
    const previous = process.env.BOOTSTRAP_ADMIN_TOKEN;
    process.env.BOOTSTRAP_ADMIN_TOKEN = "bootstrap-test-token";
    expect(isValidBootstrapToken("bootstrap-test-token")).toBe(true);
    expect(isValidBootstrapToken("wrong-token")).toBe(false);
    if (previous === undefined) delete process.env.BOOTSTRAP_ADMIN_TOKEN;
    else process.env.BOOTSTRAP_ADMIN_TOKEN = previous;
  });

  it("rejects JSON bodies above the configured limit", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: JSON.stringify({ value: "x".repeat(32) }),
      headers: { "content-type": "application/json" },
    });
    await expect(readJsonWithLimit(request, 16)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });
});
