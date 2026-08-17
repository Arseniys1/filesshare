import { NextRequest, NextResponse } from "next/server";
import {
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
    const expiresAt = group?.expires_at ?? file?.expires_at ?? null;
    if (isExpired(expiresAt)) {
      return NextResponse.json({ error: "Срок действия ссылки истёк" }, { status: 410 });
    }
    const passwordHash = group?.password_hash ?? file?.password_hash ?? null;
    if (!passwordHash) {
      return NextResponse.json({ error: "Для файла не требуется пароль" }, { status: 400 });
    }

    const body = (await request.json()) as { password?: unknown };
    if (typeof body.password !== "string" || !body.password || body.password.length > 1024) {
      return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
    }

    const verification = await verifyPassword(body.password, passwordHash);
    if (!verification.valid) {
      return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
    }
    if (verification.needsRehash) {
      if (group) updateFileGroupPasswordHash(token, await hashPassword(body.password));
      else updateFilePasswordHash(token, await hashPassword(body.password));
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
