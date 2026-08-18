import { NextRequest, NextResponse } from "next/server";
import {
  countRecentTelemetryEvents,
  createTelemetryEvent,
} from "@/lib/db";
import {
  classifyUserAgent,
  getClientIp,
  hashClientIp,
  isSameOrigin,
  parseTelemetryPayload,
} from "@/lib/telemetry";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  }

  const maxPayloadBytes = 128 * 1024;
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > maxPayloadBytes) {
    return NextResponse.json({ error: "Слишком большой запрос" }, { status: 413 });
  }

  let payload: unknown;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > maxPayloadBytes) {
      return NextResponse.json({ error: "Слишком большой запрос" }, { status: 413 });
    }
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const event = parseTelemetryPayload(payload);
  if (!event) {
    return NextResponse.json({ error: "Некорректное событие телеметрии" }, { status: 400 });
  }

  const serverIp = getClientIp(request);
  const ip = hashClientIp(serverIp);
  if (ip.hash && countRecentTelemetryEvents(ip.hash, 5) >= 60) {
    return NextResponse.json(
      { error: "Слишком много событий" },
      { status: 429, headers: { "Retry-After": "300" } }
    );
  }

  const userAgent = classifyUserAgent(request.headers.get("user-agent"));
  createTelemetryEvent({
    eventName: event.eventName,
    consentVersion: event.consentVersion,
    visitorId: event.visitorId,
    fingerprintResult: event.fingerprintResult,
    browserToolResult: event.browserToolResult,
    clientIp: event.clientIp,
    serverIp,
    ipHash: ip.hash,
    ipHashDay: ip.day,
    ...userAgent,
    language: event.language,
    viewportBucket: event.viewportBucket,
    path: event.path,
  });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
