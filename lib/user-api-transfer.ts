import type { FileWithAccount, OwnedTransferDetails, OwnedTransferRecord } from "@/lib/db";
import { isExpired } from "@/lib/utils";

function mapFile(file: FileWithAccount) {
  return {
    token: file.token,
    name: file.original_name,
    size: file.size,
    mimeType: file.mime_type,
    expiresAt: file.expires_at,
    downloadCount: file.download_count,
    maxDownloads: file.max_downloads,
    hasPassword: Boolean(file.password_hash),
    revoked: Boolean(file.revoked_at),
    storageEncrypted: file.storage_encryption === "server-v1",
    contentEncryption: file.content_encryption,
    createdAt: file.created_at,
  };
}

export function mapTransfer(item: OwnedTransferRecord, origin: string) {
  return {
    kind: item.kind,
    token: item.token,
    name: item.name,
    size: item.size,
    fileCount: item.file_count,
    expiresAt: item.expires_at,
    downloadCount: item.download_count,
    maxDownloads: item.max_downloads,
    hasPassword: Boolean(item.has_password),
    storageEncrypted: Boolean(item.storage_encrypted),
    contentEncryption: item.content_encryption,
    createdAt: item.created_at,
    revoked: Boolean(item.revoked_at),
    expired: item.expires_at !== null && isExpired(item.expires_at),
    shareUrl: `${origin}/f/${item.token}`,
    canRecreateLink: item.content_encryption !== "e2ee-v1",
  };
}

export function mapTransferDetails(details: OwnedTransferDetails, origin: string) {
  return {
    kind: details.kind,
    token: details.token,
    shareUrl: `${origin}/f/${details.token}`,
    canRecreateLink: details.files.every((file) => file.content_encryption !== "e2ee-v1"),
    group: details.group ? {
      token: details.group.token,
      expiresAt: details.group.expires_at,
      downloadCount: details.group.download_count,
      maxDownloads: details.group.max_downloads,
      hasPassword: Boolean(details.group.password_hash),
      revoked: Boolean(details.group.revoked_at),
      createdAt: details.group.created_at,
    } : null,
    file: details.file ? mapFile(details.file) : null,
    files: details.files.map(mapFile),
  };
}
