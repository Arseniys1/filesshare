import { NextResponse, type NextRequest } from "next/server";
import { resolveApiKey, type ApiAuthContext } from "@/lib/api-keys";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export function apiError(
  code: string,
  message: string,
  status: number,
  headers?: HeadersInit
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

export function requireApiKey(request: NextRequest):
  | { context: ApiAuthContext; response: null }
  | { context: null; response: NextResponse<ApiErrorBody> } {
  const result = resolveApiKey(request);
  if (result.context) return { context: result.context, response: null };
  if (result.failure === "blocked") {
    return {
      context: null,
      response: apiError("user_blocked", "Пользователь заблокирован", 403),
    };
  }
  return {
    context: null,
    response: apiError(
      result.failure === "missing" ? "missing_api_key" : "invalid_api_key",
      result.failure === "missing" ? "Требуется API-ключ" : "Недействительный API-ключ",
      401,
      { "WWW-Authenticate": "Bearer" }
    ),
  };
}

export function apiOk<T>(body: T, status = 200): NextResponse<T> {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Некорректное тело запроса");
  }
  return value as Record<string, unknown>;
}

export function errorFromException(error: unknown, fallback: string, status = 400): NextResponse<ApiErrorBody> {
  return apiError("invalid_request", error instanceof Error ? error.message : fallback, status);
}
