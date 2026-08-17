import { NextRequest, NextResponse } from "next/server";
import { createFileGroup, getUserById, getUserQuotaUsage } from "@/lib/db";
import { getCurrentUserStatus } from "@/lib/auth";
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

function parseMaxRecipients(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000_000) throw new Error("Лимит получателей должен быть от 1 до 1 000 000");
  return parsed;
}

export async function POST(request: NextRequest) {
  try {
    const sessionStatus = getCurrentUserStatus(request);
    if (sessionStatus.blocked) return NextResponse.json({ error: "Пользователь заблокирован" }, { status: 403 });
    const user = sessionStatus.user;
    const body = (await request.json()) as {
      expiry?: unknown;
      password?: unknown;
      pin?: unknown;
      maxDownloads?: unknown;
      oneTime?: unknown;
      maxRecipients?: unknown;
    };
    const expiry = typeof body.expiry === "string" ? body.expiry : "never";
    if (!EXPIRY_OPTIONS.some((option) => option.value === expiry)) {
      return NextResponse.json({ error: "Некорректный срок действия ссылки" }, { status: 400 });
    }
    const password = body.password === undefined ? "" : body.password;
    if (typeof password !== "string" || password.length > 1024) {
      return NextResponse.json({ error: "Пароль слишком длинный" }, { status: 400 });
    }
    const pin = body.pin === undefined ? "" : body.pin;
    if (typeof pin !== "string" || (pin && (pin.length < 4 || pin.length > 32))) {
      return NextResponse.json({ error: "PIN-код должен содержать от 4 до 32 символов" }, { status: 400 });
    }

    const requestedMaxDownloads = parseMaxDownloads(body.maxDownloads);
    const maxRecipients = parseMaxRecipients(body.maxRecipients);
    if (user) {
      const userRecord = getUserById(user.id);
      if (userRecord?.blocked_at) return NextResponse.json({ error: "Пользователь заблокирован" }, { status: 403 });
      if (userRecord?.active_link_limit && getUserQuotaUsage(user.id).activeLinks >= userRecord.active_link_limit) {
        return NextResponse.json({ error: "Превышен лимит активных ссылок пользователя" }, { status: 429 });
      }
      if (requestedMaxDownloads !== null && userRecord?.max_downloads && requestedMaxDownloads > userRecord.max_downloads) {
        return NextResponse.json({ error: "Лимит скачиваний превышает ограничение пользователя" }, { status: 400 });
      }
    }
    const group = createFileGroup({
      token: generateFileToken(),
      ownerUserId: user?.id ?? null,
      expiresAt: computeExpiresAt(expiry),
      maxDownloads: requestedMaxDownloads ?? (user ? getUserById(user.id)?.max_downloads ?? null : null),
      passwordHash: password ? await hashPassword(password) : null,
      pinHash: pin ? await hashPassword(pin) : null,
      oneTime: body.oneTime === true || body.oneTime === "true",
      maxRecipients,
    });

    return NextResponse.json({
      success: true,
      group: {
        token: group.token,
        shareUrl: `${request.nextUrl.origin}/f/${group.token}`,
        expiresAt: group.expires_at,
        maxDownloads: group.max_downloads,
        hasPassword: !!group.password_hash,
        hasPin: !!group.pin_hash,
        oneTime: Boolean(group.one_time),
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
