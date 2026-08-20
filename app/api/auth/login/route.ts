import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, updateUserPassword } from "@/lib/db";
import {
  createUserSession,
  getPublicUser,
  normalizeEmail,
  setSessionCookie,
} from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/utils";
import { consumeRequestRateLimit, clearRequestRateLimit, getRequestIp } from "@/lib/request-rate-limit";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonWithLimit<{ email?: unknown; password?: unknown }>(request, 32 * 1024);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    const ipLimit = consumeRequestRateLimit("auth-login-ip", getRequestIp(request.headers), 5);
    if (!ipLimit.allowed) return NextResponse.json({ error: "Слишком много попыток входа. Попробуйте позже." }, { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } });
    const emailLimit = consumeRequestRateLimit("auth-login-email", email || "empty", 10);
    if (!emailLimit.allowed) return NextResponse.json({ error: "Слишком много попыток входа. Попробуйте позже." }, { status: 429, headers: { "Retry-After": String(emailLimit.retryAfterSeconds) } });
    const user = getUserByEmail(email);

    if (!user) {
      return NextResponse.json({ error: "Неверный email или пароль" }, { status: 401 });
    }

    const verification = await verifyPassword(password, user.password_hash);
    if (!verification.valid) {
      return NextResponse.json({ error: "Неверный email или пароль" }, { status: 401 });
    }
    if (verification.needsRehash) {
      updateUserPassword(user.id, await hashPassword(password));
    }

    clearRequestRateLimit(ipLimit.key);
    clearRequestRateLimit(emailLimit.key);

    const response = NextResponse.json({ user: getPublicUser(user) });
    setSessionCookie(response, createUserSession(user.id));
    return response;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 });
    console.error("Login error:", error);
    return NextResponse.json({ error: "Не удалось выполнить вход" }, { status: 500 });
  }
}
