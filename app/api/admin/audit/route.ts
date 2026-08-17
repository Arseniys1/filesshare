import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAdminAuditEvents } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const limit = Number(request.nextUrl.searchParams.get("limit") || "100");
  return NextResponse.json({ events: getAdminAuditEvents(Number.isFinite(limit) ? limit : 100) });
}
