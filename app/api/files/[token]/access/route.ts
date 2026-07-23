import { NextRequest, NextResponse } from "next/server";
import { getFileByToken, updateFilePasswordHash } from "@/lib/db";
import {
  createDownloadGrant,
  getDownloadGrantCookieName,
  isSafeFileToken,
} from "@/lib/download-grant";
import { isExpired, hashPassword, verifyPassword } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!isSafeFileToken(token)) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    }
    const file = getFileByToken(token);
    if (!file) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    }
    if (isExpired(file.expires_at)) {
      return NextResponse.json({ error: "Срок действия ссылки истёк" }, { status: 410 });
    }
    if (!file.password_hash) {
      return NextResponse.json({ error: "Для файла не требуется пароль" }, { status: 400 });
    }

    const body = (await request.json()) as { password?: unknown };
    if (typeof body.password !== "string" || !body.password || body.password.length > 1024) {
      return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
    }

    const verification = await verifyPassword(body.password, file.password_hash);
    if (!verification.valid) {
      return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
    }
    if (verification.needsRehash) {
      updateFilePasswordHash(token, await hashPassword(body.password));
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
      path: `/api/download/${token}`,
      expires: grant.expiresAt,
    });
    return response;
  } catch (error) {
    console.error("File access error:", error);
    return NextResponse.json({ error: "Ошибка проверки пароля" }, { status: 500 });
  }
}
