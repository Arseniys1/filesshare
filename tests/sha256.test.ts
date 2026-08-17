import { describe, expect, it } from "vitest";
import { Sha256 } from "@/lib/sha256";

describe("incremental SHA-256", () => {
  it("matches the standard empty and split-input vectors", () => {
    expect(new Sha256().digest()).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    const hash = new Sha256();
    hash.update(new TextEncoder().encode("The quick brown "));
    hash.update(new TextEncoder().encode("fox jumps over the lazy dog"));
    expect(hash.digest()).toBe("d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592");
  });
});
