import { NextRequest, NextResponse } from "next/server";
import { getUserByEmail, updateUserPassword } from "@/lib/db";
import {
  createUserSession,
  getPublicUser,
  normalizeEmail,
  setSessionCookie,
} from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
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

    const response = NextResponse.json({ user: getPublicUser(user) });
    setSessionCookie(response, createUserSession(user.id));
    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Не удалось выполнить вход" }, { status: 500 });
  }
}
