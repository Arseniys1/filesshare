import { NextRequest, NextResponse } from "next/server";
import { revokeUserApiKey } from "@/lib/api-keys";
import { getCurrentUserStatus } from "@/lib/auth";

export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const status = getCurrentUserStatus(request);
  if (status.blocked) return NextResponse.json({ error: "Пользователь заблокирован" }, { status: 403 });
  if (!status.user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Некорректный ID ключа" }, { status: 400 });
  if (!revokeUserApiKey(status.user.id, id)) return NextResponse.json({ error: "API-ключ не найден" }, { status: 404 });
  return NextResponse.json({ success: true });
}
