import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return NextResponse.json({ user: getCurrentUser(request) });
}
