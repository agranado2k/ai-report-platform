import { describe, expect, it } from "vitest";
import { Sha256Hasher } from "./hasher";

describe("Sha256Hasher", () => {
  const hasher = new Sha256Hasher();

  it("matches the known SHA-256 of a fixed input", () => {
    // echo -n "abc" | sha256sum
    expect(hasher.hash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is deterministic and 64 hex chars", () => {
    const a = hasher.hash("user\nPOST /api/v1/reports\nhash\nfolder:1");
    expect(a).toBe(hasher.hash("user\nPOST /api/v1/reports\nhash\nfolder:1"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("separates distinct inputs", () => {
    expect(hasher.hash("a")).not.toBe(hasher.hash("b"));
  });
});
