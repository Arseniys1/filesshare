import { NextRequest } from "next/server";
import { createFileGroup, getUserById, getUserQuotaUsage } from "@/lib/db";
import { apiError, apiOk, parseJsonObject, requireApiKey } from "@/lib/api-v1";
import { computeExpiresAt, generateFileToken, hashPassword } from "@/lib/utils";
import { parseExpiry, parseMaxDownloads, parseOptionalPassword } from "@/lib/user-api-input";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth.response) return auth.response;
  try {
    const body = parseJsonObject(await request.json());
    const user = getUserById(auth.context.user.id);
    if (!user || user.blocked_at) return apiError("user_blocked", "Пользователь заблокирован", 403);
    const expiry = parseExpiry(body.expiry);
    const password = parseOptionalPassword(body.password);
    const requestedMaxDownloads = parseMaxDownloads(body.maxDownloads);
    if (user.active_link_limit && getUserQuotaUsage(user.id).activeLinks >= user.active_link_limit) {
      return apiError("active_link_limit_exceeded", "Превышен лимит активных ссылок пользователя", 429);
    }
    if (requestedMaxDownloads !== null && user.max_downloads && requestedMaxDownloads > user.max_downloads) {
      return apiError("max_downloads_exceeded", "Лимит скачиваний превышает ограничение пользователя", 400);
    }
    const group = createFileGroup({
      token: generateFileToken(),
      ownerUserId: user.id,
      expiresAt: computeExpiresAt(expiry),
      maxDownloads: requestedMaxDownloads ?? user.max_downloads ?? null,
      passwordHash: password ? await hashPassword(password) : null,
    });
    return apiOk({
      token: group.token,
      shareUrl: `${request.nextUrl.origin}/f/${group.token}`,
      expiresAt: group.expires_at,
      maxDownloads: group.max_downloads,
      hasPassword: Boolean(group.password_hash),
    }, 201);
  } catch (error) {
    return apiError("invalid_request", error instanceof Error ? error.message : "Ошибка создания группы файлов", 400);
  }
}
