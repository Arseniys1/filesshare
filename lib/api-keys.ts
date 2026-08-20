import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import {
  countActiveApiKeys,
  createApiKey as insertApiKey,
  getApiKeyByHash,
  getUserById,
  listApiKeys,
  listActiveApiKeysPage,
  revokeApiKey,
  touchApiKey,
  type ApiKeyRecord,
  type AuthUserRecord,
} from "@/lib/db";
import { hashOpaqueToken } from "@/lib/auth";

export const API_KEY_PREFIX = "fs_live_";
export const API_KEY_MAX_ACTIVE = 20;

export interface ApiKeyPublic {
  id: number;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
}

export interface ApiAuthContext {
  user: AuthUserRecord;
  apiKey: ApiKeyRecord;
}

export type ApiKeyAuthFailure = "missing" | "invalid" | "blocked";

function toPublicApiKey(key: ApiKeyRecord): ApiKeyPublic {
  return {
    id: key.id,
    name: key.name,
    prefix: key.key_prefix,
    lastUsedAt: key.last_used_at,
    revokedAt: key.revoked_at,
    createdAt: key.created_at,
    active: key.revoked_at === null,
  };
}

export function getPublicApiKey(key: ApiKeyRecord): ApiKeyPublic {
  return toPublicApiKey(key);
}

export function listPublicApiKeys(userId: number): ApiKeyPublic[] {
  return listApiKeys(userId).filter((key) => key.revoked_at === null).map(toPublicApiKey);
}

export function listPublicApiKeysPage(userId: number, page = 1, pageSize = 10): {
  items: ApiKeyPublic[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
} {
  const result = listActiveApiKeysPage(userId, page, pageSize);
  return { ...result, items: result.items.map(toPublicApiKey) };
}

export function createUserApiKey(userId: number, name: string): {
  key: ApiKeyPublic;
  secret: string;
} {
  const normalizedName = name.trim();
  if (normalizedName.length < 1 || normalizedName.length > 64) {
    throw new Error("Название ключа должно содержать от 1 до 64 символов");
  }
  if (countActiveApiKeys(userId) >= API_KEY_MAX_ACTIVE) {
    throw new Error(`Можно создать не более ${API_KEY_MAX_ACTIVE} активных ключей`);
  }

  const secret = `${API_KEY_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  const key = insertApiKey({
    userId,
    name: normalizedName,
    keyPrefix: `${API_KEY_PREFIX}${secret.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + 8)}…`,
    keyHash: hashOpaqueToken(secret),
  });
  return { key: toPublicApiKey(key), secret };
}

export function readBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function resolveApiKey(request: NextRequest): {
  context: ApiAuthContext | null;
  failure: ApiKeyAuthFailure | null;
} {
  const token = readBearerToken(request);
  if (!token) return { context: null, failure: "missing" };
  const apiKey = getApiKeyByHash(hashOpaqueToken(token));
  if (!apiKey) return { context: null, failure: "invalid" };
  const user = getUserById(apiKey.user_id);
  if (!user) return { context: null, failure: "invalid" };
  if (user.blocked_at) return { context: null, failure: "blocked" };
  touchApiKey(apiKey.id);
  return { context: { user, apiKey }, failure: null };
}

export function revokeUserApiKey(userId: number, id: number): boolean {
  return revokeApiKey(userId, id);
}
