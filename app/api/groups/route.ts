import { NextRequest, NextResponse } from "next/server";
import { createFileGroup } from "@/lib/db";
import { EXPIRY_OPTIONS, computeExpiresAt, generateFileToken, hashPassword } from "@/lib/utils";

export const runtime = "nodejs";

function parseMaxDownloads(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("Лимит скачиваний должен быть целым числом");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
    throw new Error("Лимит скачиваний должен быть от 1 до 1 000 000");
  }
  return parsed;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      expiry?: unknown;
      password?: unknown;
      maxDownloads?: unknown;
    };
    const expiry = typeof body.expiry === "string" ? body.expiry : "never";
    if (!EXPIRY_OPTIONS.some((option) => option.value === expiry)) {
      return NextResponse.json({ error: "Некорректный срок действия ссылки" }, { status: 400 });
    }
    const password = body.password === undefined ? "" : body.password;
    if (typeof password !== "string" || password.length > 1024) {
      return NextResponse.json({ error: "Пароль слишком длинный" }, { status: 400 });
    }

    const group = createFileGroup({
      token: generateFileToken(),
      expiresAt: computeExpiresAt(expiry),
      maxDownloads: parseMaxDownloads(body.maxDownloads),
      passwordHash: password ? await hashPassword(password) : null,
    });

    return NextResponse.json({
      success: true,
      group: {
        token: group.token,
        shareUrl: `${request.nextUrl.origin}/f/${group.token}`,
        expiresAt: group.expires_at,
        maxDownloads: group.max_downloads,
        hasPassword: !!group.password_hash,
      },
    });
  } catch (error) {
    console.error("Group creation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка создания группы файлов" },
      { status: 400 }
    );
  }
}
