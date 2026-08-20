import { NextRequest, NextResponse } from "next/server";
import { createFileGroup, getUserById, getUserQuotaUsage } from "@/lib/db";
import { getCurrentUserStatus } from "@/lib/auth";
import { EXPIRY_OPTIONS, computeExpiresAt, generateFileToken, hashPassword } from "@/lib/utils";
import { consumeRequestRateLimit, getRequestIp } from "@/lib/request-rate-limit";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

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
    const rate = consumeRequestRateLimit("group-create-ip", getRequestIp(request.headers), 10);
    if (!rate.allowed) return NextResponse.json({ error: "Слишком много создаваемых групп. Попробуйте позже." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
    const sessionStatus = getCurrentUserStatus(request);
    if (sessionStatus.blocked) return NextResponse.json({ error: "Пользователь заблокирован" }, { status: 403 });
    const user = sessionStatus.user;
    const body = await readJsonWithLimit<{
      expiry?: unknown;
      password?: unknown;
      maxDownloads?: unknown;
    }>(request, 32 * 1024);
    const expiry = typeof body.expiry === "string" ? body.expiry : "never";
    if (!EXPIRY_OPTIONS.some((option) => option.value === expiry)) {
      return NextResponse.json({ error: "Некорректный срок действия ссылки" }, { status: 400 });
    }
    const password = body.password === undefined ? "" : body.password;
    if (typeof password !== "string" || password.length > 1024) {
      return NextResponse.json({ error: "Пароль слишком длинный" }, { status: 400 });
    }
    const requestedMaxDownloads = parseMaxDownloads(body.maxDownloads);
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
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 });
    console.error("Group creation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка создания группы файлов" },
      { status: 400 }
    );
  }
}
