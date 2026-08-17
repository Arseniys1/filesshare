import { NextRequest, NextResponse } from "next/server";
import { getShortLink } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const link = getShortLink(code);
  if (!link) return NextResponse.json({ error: "Ссылка не найдена" }, { status: 404 });
  return NextResponse.redirect(new URL(`/f/${encodeURIComponent(link.target_token)}`, request.url), 307);
}
