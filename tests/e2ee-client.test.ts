import { describe, expect, it } from "vitest";
import {
  addE2EEKeyToShareUrl,
  addE2EEKeysToShareUrl,
  createBufferedE2EEMultipartUpload,
  createE2EEUpload,
  decryptE2EEToSink,
  downloadE2EEFile,
  readE2EEKeyFromHash,
  readE2EEKeysFromHash,
} from "@/lib/e2ee-client";

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
    total += next.value.length;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.length);
  copy.set(value);
  return copy.buffer;
}

describe("client-side E2EE", () => {
  it("encrypts and decrypts a streamed file without the server key", async () => {
    const original = new Uint8Array(1024 * 1024 + 17);
    for (let index = 0; index < original.length; index += 1) original[index] = index % 239;
    const file = new File([original], "example.bin", { type: "application/octet-stream" });
    const encrypted = createE2EEUpload(file);
    const encryptedBytes = await readStream(encrypted.body);
    const output: Uint8Array[] = [];

    await decryptE2EEToSink(
      new Blob([asArrayBuffer(encryptedBytes)]).stream(),
      readE2EEKeyFromHash(`#key=${encrypted.key}`)!,
      {
        write: async (chunk) => {
          output.push(chunk);
        },
        close: async () => {},
      },
      original.length
    );

    const decrypted = new Uint8Array(output.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of output) {
      decrypted.set(chunk, offset);
      offset += chunk.length;
    }
    expect(decrypted).toEqual(original);
  }, 30_000);

  it("keeps the E2EE key in the URL fragment", () => {
    const shareUrl = addE2EEKeyToShareUrl("https://files.example/f/token", "abc_def");
    expect(shareUrl).toBe("https://files.example/f/token#key=abc_def");
    expect(() => readE2EEKeyFromHash("#key=abc_def")).toThrow();
  });

  it("keeps a key map for a group in the URL fragment", () => {
    const shareUrl = addE2EEKeysToShareUrl("https://files.example/f/group-token", {
      FileToken1: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      FileToken2: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    });
    const keys = readE2EEKeysFromHash(new URL(shareUrl).hash);

    expect(shareUrl).toContain("#keys=");
    expect(keys.FileToken1).toHaveLength(32);
    expect(keys.FileToken2).toHaveLength(32);
  });

  it("can materialize a small E2EE multipart request for HTTP fallbacks", async () => {
    const upload = await createBufferedE2EEMultipartUpload(
      new File(["hello"], "hello.txt", { type: "text/plain" }),
      { contentEncryption: "e2ee-v1", originalSize: "5" }
    );
    expect(upload.body.size).toBeGreaterThan(0);
    expect(upload.body.type).toContain(upload.boundary.toLowerCase());
    expect(upload.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("downloads small E2EE files without opening a save picker", async () => {
    const original = new Uint8Array(4096);
    original.fill(37);
    const encrypted = createE2EEUpload(new File([original], "photo.jpg", { type: "image/jpeg" }));
    const encryptedBytes = await readStream(encrypted.body);
    let savedBlob: Blob | null = null;
    let clicked = false;

    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        setTimeout,
        showSaveFilePicker: async () => {
          throw new Error("The save picker must not be called for a small file");
        },
      },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => ({
          click: () => {
            clicked = true;
          },
        }),
      },
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: (blob: Blob) => {
        savedBlob = blob;
        return "blob:test";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: () => {},
    });

    try {
      await downloadE2EEFile({
        response: new Response(new Blob([asArrayBuffer(encryptedBytes)])),
        rawKey: readE2EEKeyFromHash(`#key=${encrypted.key}`)!,
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        size: original.length,
      });
    } finally {
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      else delete (globalThis as { window?: unknown }).window;
      if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
      else delete (globalThis as { document?: unknown }).document;
      if (createObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
      else delete (URL as { createObjectURL?: unknown }).createObjectURL;
      if (revokeObjectUrlDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeObjectUrlDescriptor);
      else delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
    }

    expect(clicked).toBe(true);
    expect(savedBlob).not.toBeNull();
    expect(new Uint8Array(await savedBlob!.arrayBuffer())).toEqual(original);
  });
});
