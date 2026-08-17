import { NextRequest, NextResponse } from "next/server";
import { createUser, getUserByEmail } from "@/lib/db";
import {
  createUserSession,
  getPublicUser,
  isValidEmail,
  normalizeEmail,
  setSessionCookie,
  validatePassword,
} from "@/lib/auth";
import { hashPassword } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = normalizeEmail(body.email);
    const password = body.password;
    const passwordConfirmation = body.passwordConfirmation;

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
