import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserStatus, getPublicUser } from "@/lib/auth";
import { getUserById, updateUserAvatarSeed } from "@/lib/db";

export const runtime = "nodejs";

export function POST(request: NextRequest) {
  const status = getCurrentUserStatus(request);
  if (status.blocked) {
    return NextResponse.json({ error: "Пользователь заблокирован" }, { status: 403 });
  }
  if (!status.user) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const avatarSeed = crypto.randomBytes(16).toString("hex");
  updateUserAvatarSeed(status.user.id, avatarSeed);
  const user = getUserById(status.user.id);
  if (!user) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  return NextResponse.json(
    { user: getPublicUser(user) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
