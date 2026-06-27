import { NextRequest, NextResponse } from "next/server";
import {
  getAllStorageAccounts,
  createStorageAccount,
  updateStorageAccount,
  deleteStorageAccount,
} from "@/lib/db";
import { testBotConnection } from "@/lib/telegram";
import { getStats } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

function checkAdminAuth(request: NextRequest): boolean {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return true;
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${adminKey}`;
}

export async function GET(request: NextRequest) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accounts = getAllStorageAccounts();
  const stats = getStats();

  return NextResponse.json({
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      channelId: a.channel_id,
      isActive: !!a.is_active,
      filesCount: a.files_count,
      createdAt: a.created_at,
      botToken: a.bot_token.slice(0, 10) + "...",
    })),
    stats,
  });
}

export async function POST(request: NextRequest) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, botToken, channelId, testConnection } = body;

    if (!name || !botToken || !channelId) {
      return NextResponse.json(
        { error: "Заполните все поля: name, botToken, channelId" },
        { status: 400 }
      );
    }

    if (testConnection !== false) {
      try {
        const test = await testBotConnection(botToken, channelId);
        if (!test.ok) {
          return NextResponse.json(
            { error: `Ошибка подключения: ${test.error}` },
            { status: 400 }
          );
        }
      } catch (err) {
        return NextResponse.json(
          {
            error:
              err instanceof Error
                ? err.message
                : "Не удалось проверить подключение к Telegram",
          },
          { status: 502 }
        );
      }
    }

    const account = createStorageAccount(name, botToken, channelId);

    return NextResponse.json({
      success: true,
      account: {
        id: account.id,
        name: account.name,
        channelId: account.channel_id,
        isActive: !!account.is_active,
        filesCount: account.files_count,
        createdAt: account.created_at,
      },
    });
  } catch (err) {
    console.error("Create account error:", err);
    const message =
      err instanceof Error && err.message.includes("UNIQUE")
        ? "Бот с таким токеном уже добавлен"
        : "Ошибка при создании аккаунта";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, name, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: "ID обязателен" }, { status: 400 });
    }

    updateStorageAccount(id, {
      name,
      is_active: isActive,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Update account error:", err);
    return NextResponse.json(
      { error: "Ошибка при обновлении аккаунта" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!checkAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID обязателен" }, { status: 400 });
    }

    deleteStorageAccount(parseInt(id, 10));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete account error:", err);
    return NextResponse.json(
      { error: "Ошибка при удалении аккаунта" },
      { status: 500 }
    );
  }
}
