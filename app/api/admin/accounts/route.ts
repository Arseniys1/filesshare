import { NextRequest, NextResponse } from "next/server";
import {
  getAllStorageAccounts,
  createStorageAccount,
  updateStorageAccount,
  deleteStorageAccount,
  getStorageAccountFileCount,
} from "@/lib/db";
import { testBotConnection } from "@/lib/telegram";
import { getStats } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

function requireAdmin(request: NextRequest): NextResponse | null {
  const user = getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

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
  const authError = requireAdmin(request);
  if (authError) return authError;

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
  const authError = requireAdmin(request);
  if (authError) return authError;

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
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID обязателен" }, { status: 400 });
    }

    const accountId = Number(id);
    if (!Number.isSafeInteger(accountId) || accountId < 1) {
      return NextResponse.json({ error: "Некорректный ID" }, { status: 400 });
    }
    if (getStorageAccountFileCount(accountId) > 0) {
      return NextResponse.json(
        {
          error:
            "Нельзя удалить аккаунт, пока в нём есть файлы. Отключите его: существующие ссылки продолжат работать, а аккаунт можно будет удалить после очистки.",
        },
        { status: 409 }
      );
    }
    if (!deleteStorageAccount(accountId)) {
      return NextResponse.json({ error: "Аккаунт не найден" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete account error:", err);
    return NextResponse.json(
      { error: "Ошибка при удалении аккаунта" },
      { status: 500 }
    );
  }
}
