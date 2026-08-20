import { NextRequest, NextResponse } from "next/server";
import { resetPasswordWithToken, validatePassword } from "@/lib/auth";
import { hashPassword } from "@/lib/utils";
import { consumeRequestRateLimit, getRequestIp } from "@/lib/request-rate-limit";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const rate = consumeRequestRateLimit("auth-reset-ip", getRequestIp(request.headers), 10);
    if (!rate.allowed) return NextResponse.json({ error: "Слишком много попыток. Попробуйте позже." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
    const body = await readJsonWithLimit<{ token?: unknown; password?: unknown; passwordConfirmation?: unknown }>(request, 16 * 1024);
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const passwordConfirmation = typeof body.passwordConfirmation === "string" ? body.passwordConfirmation : "";

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
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 });
    console.error("Password reset error:", error);
    return NextResponse.json({ error: "Не удалось изменить пароль" }, { status: 500 });
  }
}
