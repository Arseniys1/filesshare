import { NextRequest, NextResponse } from "next/server";
import { getFileByToken, incrementDownloadCount } from "@/lib/db";
import { getTelegramFile, downloadTelegramFile } from "@/lib/telegram";
import { isExpired, verifyPassword } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const file = getFileByToken(token);

    if (!file) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    }

    if (isExpired(file.expires_at)) {
      return NextResponse.json(
        { error: "Срок действия ссылки истёк" },
        { status: 410 }
      );
    }

    if (file.max_downloads && file.download_count >= file.max_downloads) {
      return NextResponse.json(
        { error: "Достигнут лимит скачиваний" },
        { status: 410 }
      );
    }

    if (file.password_hash) {
      const password =
        request.headers.get("x-file-password") ||
        request.nextUrl.searchParams.get("password");

      if (!password || !verifyPassword(password, file.password_hash)) {
        return NextResponse.json(
          { error: "Требуется пароль", requiresPassword: true },
          { status: 401 }
        );
      }
    }

    const telegramFile = await getTelegramFile(file.bot_token, file.telegram_file_id);

    if (!telegramFile.file_path) {
      return NextResponse.json(
        { error: "Файл недоступен для скачивания" },
        { status: 500 }
      );
    }

    const fileData = await downloadTelegramFile(
      file.bot_token,
      telegramFile.file_path
    );

    incrementDownloadCount(token);

    return new NextResponse(fileData, {
      headers: {
        "Content-Type": file.mime_type,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.original_name)}"`,
        "Content-Length": file.size.toString(),
      },
    });
  } catch (err) {
    console.error("Download error:", err);
    return NextResponse.json(
      { error: "Ошибка при скачивании файла" },
      { status: 500 }
    );
  }
}
