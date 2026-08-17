import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getFileByToken, getFileGroupById, getFileGroupByToken, getFilesByGroupId } from "@/lib/db";
import { RECIPIENT_COOKIE_NAME } from "@/lib/download-grant";
import { isExpired } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const group = getFileGroupByToken(token);
    if (group) {
      const files = getFilesByGroupId(group.id);
      if (files.length === 0) {
        return NextResponse.json({ error: "Группа файлов пуста" }, { status: 404 });
      }
      const expired = isExpired(group.expires_at);
      const revoked = group.revoked_at !== null;
      const downloadsExceeded =
        group.max_downloads !== null && group.download_count >= group.max_downloads;

      const response = NextResponse.json({
        kind: "group",
        token: group.token,
        name: `Пакет из ${files.length} файлов`,
        size: files.reduce((total, file) => total + file.size, 0),
        expiresAt: group.expires_at,
        downloadCount: group.download_count,
        maxDownloads: group.max_downloads,
        hasPassword: !!group.password_hash,
        hasPin: !!group.pin_hash,
        oneTime: Boolean(group.one_time),
        used: Boolean(group.used_at),
        createdAt: group.created_at,
        expired,
        revoked,
        downloadsExceeded,
        available: !expired && !revoked && !downloadsExceeded,
        files: files.map((file) => ({
          token: file.token,
          name: file.original_name,
          size: file.size,
          mimeType: file.mime_type,
          storageEncrypted: file.storage_encryption === "server-v1",
          contentEncryption: file.content_encryption,
        })),
      });
      setRecipientCookie(request, response);
      return response;
    }

    const file = getFileByToken(token);

    if (!file) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    }

    const expired = isExpired(file.expires_at);
    const fileGroup = file.group_id !== null ? getFileGroupById(file.group_id) : undefined;
    const revoked = file.revoked_at !== null || Boolean(fileGroup?.revoked_at);
    const downloadsExceeded =
      file.max_downloads !== null && file.download_count >= file.max_downloads;

    const response = NextResponse.json({
      kind: "file",
      token: file.token,
      name: file.original_name,
      size: file.size,
      mimeType: file.mime_type,
      expiresAt: file.expires_at,
      downloadCount: file.download_count,
      maxDownloads: file.max_downloads,
      hasPassword: !!file.password_hash,
      hasPin: !!file.pin_hash,
      oneTime: Boolean(file.one_time),
      used: Boolean(file.used_at),
      storageEncrypted: file.storage_encryption === "server-v1",
      contentEncryption: file.content_encryption,
      createdAt: file.created_at,
      expired,
      revoked,
      downloadsExceeded,
      available: !expired && !revoked && !downloadsExceeded,
    });
    setRecipientCookie(request, response);
    return response;
  } catch (err) {
    console.error("File info error:", err);
    return NextResponse.json(
      { error: "Ошибка при получении информации о файле" },
      { status: 500 }
    );
  }
}

function setRecipientCookie(request: NextRequest, response: NextResponse): void {
  if (request.cookies.get(RECIPIENT_COOKIE_NAME)) return;
  response.cookies.set({
    name: RECIPIENT_COOKIE_NAME,
    value: crypto.randomBytes(24).toString("base64url"),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
}
