import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  encryptLegacyStorageFiles,
  getLegacyStorageStatus,
} from "@/lib/storage-migration";

export const runtime = "nodejs";
export const maxDuration = 600;

function requireAdmin(request: NextRequest): NextResponse | null {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  return null;
}

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;
  return NextResponse.json(getLegacyStorageStatus());
}

export async function POST(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const requestedLimit = Number(body.limit ?? 5);
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 20) {
      return NextResponse.json({ error: "Лимит должен быть от 1 до 20" }, { status: 400 });
    }

    const result = await encryptLegacyStorageFiles({ limit: requestedLimit });
    return NextResponse.json({ ...result, ...getLegacyStorageStatus() });
  } catch (error) {
    console.error("Storage encryption migration error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка миграции шифрования" },
      { status: 500 }
    );
  }
}
