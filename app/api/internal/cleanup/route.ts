import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cleanupExpiredFiles } from "@/lib/cleanup";

export const runtime = "nodejs";
export const maxDuration = 600;

function isAuthorized(request: NextRequest): boolean {
  const key = process.env.CLEANUP_KEY?.trim();
  if (!key) return false;
  const actual = request.headers.get("authorization") || "";
  const expected = `Bearer ${key}`;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const result = await cleanupExpiredFiles({ dryRun });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
