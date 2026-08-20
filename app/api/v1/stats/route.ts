import { NextRequest } from "next/server";
import { getOwnedTransfers, getUserDownloadStats } from "@/lib/db";
import { apiOk, requireApiKey } from "@/lib/api-v1";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth.response) return auth.response;
  const transfers = getOwnedTransfers(auth.context.user.id, { page: 1, pageSize: 1 });
  const downloads = getUserDownloadStats(auth.context.user.id, 20);
  return apiOk({
    transfers: transfers.total,
    downloads: downloads.total,
    recentDownloads: downloads.recent.map((item) => ({
      fileName: item.file_name,
      token: item.token,
      outcome: item.outcome,
      createdAt: item.created_at,
      isGroupDownload: Boolean(item.is_group_download),
    })),
  });
}
