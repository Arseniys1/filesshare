import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAdminFileOverviewPage } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const page = parsePaginationValue(request.nextUrl.searchParams.get("page"), 1);
  const limit = parsePaginationValue(request.nextUrl.searchParams.get("limit"), 20);
  const result = getAdminFileOverviewPage(request.nextUrl.searchParams.get("q") || undefined, page, limit);
  return NextResponse.json({ files: result.items, ...result });
}

function parsePaginationValue(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 10000);
}
