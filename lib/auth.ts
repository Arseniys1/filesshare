import crypto from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import {
  createPasswordResetToken as insertPasswordResetToken,
  createSession as insertSession,
  deleteSession,
  getUserBySessionHash,
  resetPasswordWithToken as resetPasswordWithTokenInDb,
  type AuthUserRecord,
  type UserRole,
} from "@/lib/db";

export const SESSION_COOKIE_NAME = "fs_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export interface PublicUser {
  id: number;
  email: string;
  role: UserRole;
  createdAt: string;
}

function toPublicUser(user: AuthUserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.created_at,
  };
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidEmail(email: string): boolean {
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 8) {
    return "Пароль должен содержать минимум 8 символов";
  }
  if (password.length > 128) {
    return "Пароль не должен быть длиннее 128 символов";
  }
  return null;
}

export function createOpaqueToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createUserSession(userId: number): string {
  const token = createOpaqueToken();
  insertSession(
    hashOpaqueToken(token),
    userId,
    Date.now() + SESSION_TTL_SECONDS * 1000
  );
  return token;
}

export function createResetToken(userId: number): string {
  const token = createOpaqueToken();
  insertPasswordResetToken(
    hashOpaqueToken(token),
    userId,
    Date.now() + PASSWORD_RESET_TTL_MS
  );
  return token;
}

export function resetPasswordWithToken(token: string, passwordHash: string): boolean {
  return resetPasswordWithTokenInDb(hashOpaqueToken(token), passwordHash);
}

export function getCurrentUser(request: NextRequest): PublicUser | null {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const user = getUserBySessionHash(hashOpaqueToken(token));
  return user ? toPublicUser(user) : null;
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function revokeCurrentSession(request: NextRequest): void {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) deleteSession(hashOpaqueToken(token));
}

export function getPublicUser(user: AuthUserRecord): PublicUser {
  return toPublicUser(user);
}
