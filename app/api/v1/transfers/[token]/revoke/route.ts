import { NextRequest } from "next/server";
import { setOwnedTransferRevoked } from "@/lib/db";
import { apiError, apiOk, requireApiKey } from "@/lib/api-v1";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const auth = requireApiKey(request);
  if (auth.response) return auth.response;
  if (!setOwnedTransferRevoked(auth.context.user.id, (await params).token, true)) return apiError("transfer_not_found", "Передача не найдена", 404);
  return apiOk({ success: true, revoked: true });
}
