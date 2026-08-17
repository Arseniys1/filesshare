import { zipSync } from "fflate";

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.length);
  copy.set(value);
  return copy.buffer;
}

function safeEntryName(name: string): string {
  return (
    name
      .replace(/[\\/\u0000-\u001F\u007F]/g, "_")
      .replace(/^\.+$/, "_")
      .slice(0, 240) || "file"
  );
}

function uniqueEntryName(name: string, used: Set<string>): string {
  const safeName = safeEntryName(name);
  if (!used.has(safeName)) return safeName;

  const dot = safeName.lastIndexOf(".");
  const base = dot > 0 ? safeName.slice(0, dot) : safeName;
  const extension = dot > 0 ? safeName.slice(dot) : "";
  let index = 2;
  let candidate = `${base} (${index})${extension}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${base} (${index})${extension}`;
  }
  return candidate;
}

export async function createZipBlob(
  files: Array<{ name: string; blob: Blob }>
): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const file of files) {
    const name = uniqueEntryName(file.name, used);
    used.add(name);
    entries[name] = new Uint8Array(await file.blob.arrayBuffer());
  }

  return new Blob([toArrayBuffer(zipSync(entries, { level: 0 }))], {
    type: "application/zip",
  });
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
