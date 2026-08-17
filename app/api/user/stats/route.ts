import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getOwnedTransfers, getUserDownloadStats } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });

  const transfers = getOwnedTransfers(user.id, { page: 1, pageSize: 1 });
  const downloads = getUserDownloadStats(user.id, 20);
  return NextResponse.json({
    transfers: transfers.total,
    downloads: downloads.total,
    recentDownloads: downloads.recent,
  });
}
