import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  clearAccessAttempts,
  consumeAccessAttempt,
  getFileByToken,
  getFileGroupByToken,
  updateFileGroupPasswordHash,
  updateFilePasswordHash,
} from "@/lib/db";
import {
  createDownloadGrant,
  getDownloadGrantCookieName,
  isSafeFileToken,
} from "@/lib/download-grant";
import { isExpired, hashPassword, verifyPassword } from "@/lib/utils";

export const runtime = "nodejs";

function accessRateKey(request: NextRequest, token: string): string {
  const forwarded = process.env.TRUST_PROXY === "1" ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined;
  const ip = forwarded || "direct";
  return crypto.createHash("sha256").update(`${token}:${ip}`).digest("hex");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!isSafeFileToken(token)) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    }
    const group = getFileGroupByToken(token);
    const file = group ? undefined : getFileByToken(token);
    if (!group && !file) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    }
    if (group?.revoked_at || file?.revoked_at) {
      return NextResponse.json({ error: "Ссылка отозвана" }, { status: 410 });
    }
    const expiresAt = group?.expires_at ?? file?.expires_at ?? null;
    if (isExpired(expiresAt)) {
      return NextResponse.json({ error: "Срок действия ссылки истёк" }, { status: 410 });
    }
    const passwordHash = group?.password_hash ?? file?.password_hash ?? null;
    const pinHash = group?.pin_hash ?? file?.pin_hash ?? null;
    if (!passwordHash && !pinHash) {
      return NextResponse.json({ error: "Для файла не требуется пароль" }, { status: 400 });
    }

    const body = (await request.json()) as { password?: unknown; pin?: unknown };
    const password = typeof body.password === "string" ? body.password : "";
    const pin = typeof body.pin === "string" ? body.pin : "";
    if ((!password && !pin) || password.length > 1024 || pin.length > 64) {
      return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
    }
    const rateKey = accessRateKey(request, token);
    const rate = consumeAccessAttempt(rateKey);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Слишком много попыток. Попробуйте позже." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
    }

    const passwordVerification = passwordHash && password ? await verifyPassword(password, passwordHash) : { valid: false, needsRehash: false };
    const pinVerification = pinHash && pin ? await verifyPassword(pin, pinHash) : { valid: false, needsRehash: false };
    if (!passwordVerification.valid && !pinVerification.valid) {
      return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
    }
    clearAccessAttempts(rateKey);
    if (passwordVerification.needsRehash && password) {
      if (group) updateFileGroupPasswordHash(token, await hashPassword(password));
      else updateFilePasswordHash(token, await hashPassword(password));
    }

    const grant = createDownloadGrant(token);
    const response = NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } }
    );
    response.cookies.set({
      name: getDownloadGrantCookieName(token),
      value: grant.value,
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: group ? "/api/download" : `/api/download/${token}`,
      expires: grant.expiresAt,
    });
    return response;
  } catch (error) {
    console.error("File access error:", error);
    return NextResponse.json({ error: "Ошибка проверки пароля" }, { status: 500 });
  }
}
