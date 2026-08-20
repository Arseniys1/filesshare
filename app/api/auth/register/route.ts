import { NextRequest, NextResponse } from "next/server";
import { createUser, getUserByEmail, getUserCount } from "@/lib/db";
import {
  createUserSession,
  getPublicUser,
  isValidEmail,
  normalizeEmail,
  setSessionCookie,
  validatePassword,
} from "@/lib/auth";
import { hashPassword } from "@/lib/utils";
import { consumeRequestRateLimit, getRequestIp } from "@/lib/request-rate-limit";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { isValidBootstrapToken } from "@/lib/bootstrap";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const rate = consumeRequestRateLimit("auth-register-ip", getRequestIp(request.headers), 10, 60 * 60 * 1000);
    if (!rate.allowed) return NextResponse.json({ error: "Слишком много регистраций. Попробуйте позже." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
    const body = await readJsonWithLimit<{ email?: unknown; password?: unknown; passwordConfirmation?: unknown; bootstrapToken?: unknown }>(request, 32 * 1024);
    if (process.env.NODE_ENV === "production" && getUserCount() === 0 && !isValidBootstrapToken(body.bootstrapToken)) {
      return NextResponse.json({ error: "Для создания первого администратора нужен bootstrap-токен" }, { status: 403 });
    }
    const email = normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    const passwordConfirmation = typeof body.passwordConfirmation === "string" ? body.passwordConfirmation : "";

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "Введите корректный email" }, { status: 400 });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }
    if (password !== passwordConfirmation) {
      return NextResponse.json({ error: "Пароли не совпадают" }, { status: 400 });
    }
    if (getUserByEmail(email)) {
      return NextResponse.json(
        { error: "Пользователь с таким email уже зарегистрирован" },
        { status: 409 }
      );
    }

    const user = createUser(email, await hashPassword(password));
    const response = NextResponse.json(
      { user: getPublicUser(user) },
      { status: 201 }
    );
    setSessionCookie(response, createUserSession(user.id));
    return response;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 });
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return NextResponse.json(
        { error: "Пользователь с таким email уже зарегистрирован" },
        { status: 409 }
      );
    }
    console.error("Registration error:", error);
    return NextResponse.json({ error: "Не удалось создать аккаунт" }, { status: 500 });
  }
}
