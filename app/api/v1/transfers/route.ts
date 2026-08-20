import { NextRequest } from "next/server";
import { getOwnedTransfers } from "@/lib/db";
import { apiOk, requireApiKey } from "@/lib/api-v1";
import { mapTransfer } from "@/lib/user-api-transfer";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth.response) return auth.response;
  const params = request.nextUrl.searchParams;
  const rawPage = Number(params.get("page") || "1");
  const rawPageSize = Number(params.get("pageSize") || "20");
  const status = params.get("status");
  const kind = params.get("kind");
  const sort = params.get("sort");
  const result = getOwnedTransfers(auth.context.user.id, {
    query: params.get("q") || undefined,
    status: status === "active" || status === "expired" || status === "revoked" || status === "password" || status === "e2ee" ? status : undefined,
    kind: kind === "file" || kind === "group" ? kind : undefined,
    sort: sort === "size" || sort === "downloads" ? sort : "created",
    page: Number.isFinite(rawPage) ? rawPage : 1,
    pageSize: Number.isFinite(rawPageSize) ? rawPageSize : 20,
  });
  return apiOk({
    items: result.items.map((item) => mapTransfer(item, request.nextUrl.origin)),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
  });
}
