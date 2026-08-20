import { NextRequest, NextResponse } from "next/server";
import { createUserApiKey, listPublicApiKeysPage } from "@/lib/api-keys";
import { getCurrentUserStatus } from "@/lib/auth";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const runtime = "nodejs";

function getUser(request: NextRequest) {
  const status = getCurrentUserStatus(request);
  if (status.blocked) return { user: null, response: NextResponse.json({ error: "Пользователь заблокирован" }, { status: 403 }) };
  if (!status.user) return { user: null, response: NextResponse.json({ error: "Требуется вход" }, { status: 401 }) };
  return { user: status.user, response: null };
}

export function GET(request: NextRequest) {
  const auth = getUser(request);
  if (!auth.user) return auth.response!;
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") || "1");
  const pageSize = Number(url.searchParams.get("pageSize") || "10");
  return NextResponse.json(listPublicApiKeysPage(auth.user.id, page, pageSize), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const auth = getUser(request);
  if (!auth.user) return auth.response!;
  try {
    const body = await readJsonWithLimit<{ name?: unknown }>(request, 16 * 1024);
    if (typeof body.name !== "string") {
      return NextResponse.json({ error: "Название ключа обязательно" }, { status: 400 });
    }
    const created = createUserApiKey(auth.user.id, body.name);
    return NextResponse.json(created, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось создать API-ключ" }, { status: 400 });
  }
}
