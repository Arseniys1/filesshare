import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getOwnedTransfers } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const kind = params.get("kind");
  const sort = params.get("sort");
  const page = Number(params.get("page") || "1");
  const pageSize = Number(params.get("pageSize") || "20");
  const result = getOwnedTransfers(user.id, {
    query: params.get("q") || undefined,
    status: status === "active" || status === "expired" || status === "revoked" || status === "password" || status === "e2ee" ? status : undefined,
    kind: kind === "file" || kind === "group" ? kind : undefined,
    sort: sort === "size" || sort === "downloads" ? sort : "created",
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 20,
  });

  return NextResponse.json({
    items: result.items.map((item) => ({
      ...item,
      shareUrl: `${request.nextUrl.origin}/f/${item.token}`,
      canRecreateLink: item.content_encryption !== "e2ee-v1",
      expired: item.expires_at !== null && new Date(item.expires_at) <= new Date(),
      revoked: item.revoked_at !== null,
    })),
    total: result.total,
    page: Math.max(Number.isFinite(page) ? page : 1, 1),
    pageSize: Math.min(Math.max(Number.isFinite(pageSize) ? pageSize : 20, 1), 100),
  });
}
