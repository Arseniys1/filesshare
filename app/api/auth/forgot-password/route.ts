import { NextRequest, NextResponse } from "next/server";
import { createResetToken, isValidEmail, normalizeEmail } from "@/lib/auth";
import { getUserByEmail } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";
import { consumeRequestRateLimit, getRequestIp } from "@/lib/request-rate-limit";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const runtime = "nodejs";

function getAppUrl(request: NextRequest): string {
  return (
    process.env.APP_URL?.trim().replace(/\/$/, "") ||
    new URL(request.url).origin
  );
}

export async function POST(request: NextRequest) {
  const responseData: { message: string; resetUrl?: string } = {
    message: "Если аккаунт с таким email существует, ссылка для восстановления отправлена.",
  };

  try {
    const ipLimit = consumeRequestRateLimit("auth-forgot-ip", getRequestIp(request.headers), 3);
    if (!ipLimit.allowed) return NextResponse.json(responseData, { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } });
    const body = await readJsonWithLimit<{ email?: unknown }>(request, 16 * 1024);
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) return NextResponse.json(responseData);

    const emailLimit = consumeRequestRateLimit("auth-forgot-email", email, 3);
    if (!emailLimit.allowed) return NextResponse.json(responseData, { status: 429, headers: { "Retry-After": String(emailLimit.retryAfterSeconds) } });

    const user = getUserByEmail(email);
    if (!user) return NextResponse.json(responseData);

    const token = createResetToken(user.id);
    const resetUrl = `${getAppUrl(request)}/reset-password?token=${encodeURIComponent(token)}`;

    try {
      const sent = await sendPasswordResetEmail(email, resetUrl);
      if (!sent && process.env.NODE_ENV !== "production") {
        responseData.resetUrl = resetUrl;
      }
    } catch (error) {
      console.error("Password reset email error:", error);
      if (process.env.NODE_ENV !== "production") {
        responseData.resetUrl = resetUrl;
      }
    }
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 });
    console.error("Password reset request error:", error);
  }

  return NextResponse.json(responseData);
}
