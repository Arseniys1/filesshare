import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { createZipBlob } from "@/lib/archive-client";

describe("client-side archive", () => {
  it("creates a safe archive with unique names", async () => {
    const archive = await createZipBlob([
      { name: "photo.txt", blob: new Blob(["first"]) },
      { name: "photo.txt", blob: new Blob(["second"]) },
    ]);
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));

    expect(Object.keys(files)).toEqual(["photo.txt", "photo (2).txt"]);
    expect(new TextDecoder().decode(files["photo.txt"])).toBe("first");
    expect(new TextDecoder().decode(files["photo (2).txt"])).toBe("second");
  });
});
