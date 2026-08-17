import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookie,
  revokeCurrentSession,
} from "@/lib/auth";

export const runtime = "nodejs";

export function POST(request: NextRequest) {
  revokeCurrentSession(request);
  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return response;
}
