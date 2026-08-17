import { NextRequest, NextResponse } from "next/server";
import { resetPasswordWithToken, validatePassword } from "@/lib/auth";
import { hashPassword } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const password = body.password;
    const passwordConfirmation = body.passwordConfirmation;

    if (token.length < 32 || token.length > 128) {
      return NextResponse.json({ error: "Ссылка восстановления недействительна" }, { status: 400 });
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }
    if (password !== passwordConfirmation) {
      return NextResponse.json({ error: "Пароли не совпадают" }, { status: 400 });
    }

    const changed = resetPasswordWithToken(token, await hashPassword(password));
    if (!changed) {
      return NextResponse.json(
        { error: "Ссылка восстановления недействительна или уже использована" },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Password reset error:", error);
    return NextResponse.json({ error: "Не удалось изменить пароль" }, { status: 500 });
  }
}
