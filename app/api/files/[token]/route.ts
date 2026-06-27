import { NextRequest, NextResponse } from "next/server";
import { getFileByToken } from "@/lib/db";
import { isExpired } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const file = getFileByToken(token);

    if (!file) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    }

    const expired = isExpired(file.expires_at);
    const downloadsExceeded =
      file.max_downloads !== null && file.download_count >= file.max_downloads;

    return NextResponse.json({
      token: file.token,
      name: file.original_name,
      size: file.size,
      mimeType: file.mime_type,
      expiresAt: file.expires_at,
      downloadCount: file.download_count,
      maxDownloads: file.max_downloads,
      hasPassword: !!file.password_hash,
      createdAt: file.created_at,
      expired,
      downloadsExceeded,
      available: !expired && !downloadsExceeded,
    });
  } catch (err) {
    console.error("File info error:", err);
    return NextResponse.json(
      { error: "Ошибка при получении информации о файле" },
      { status: 500 }
    );
  }
}
