import { NextRequest } from "next/server";
import { apiOk, requireApiKey } from "@/lib/api-v1";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth.response) return auth.response;
  const { user } = auth.context;
  return apiOk({
    id: user.id,
    email: user.email,
    createdAt: user.created_at,
  });
}
