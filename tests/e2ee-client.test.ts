import { describe, expect, it } from "vitest";
import {
  addE2EEKeyToShareUrl,
  createE2EEUpload,
  decryptE2EEToSink,
  readE2EEKeyFromHash,
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
});
