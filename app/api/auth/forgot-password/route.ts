import { NextRequest, NextResponse } from "next/server";
import { createResetToken, isValidEmail, normalizeEmail } from "@/lib/auth";
import { getUserByEmail } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";

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
    const body = await request.json();
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) return NextResponse.json(responseData);

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
    console.error("Password reset request error:", error);
  }

  return NextResponse.json(responseData);
}
