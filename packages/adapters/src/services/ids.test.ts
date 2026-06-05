import { describe, expect, it } from "vitest";
import { UuidV7IdGenerator } from "./ids";

// UUID v7: 8-4-4-4-12 hex, version nibble = 7, variant nibble ∈ {8,9,a,b}.
const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("UuidV7IdGenerator", () => {
  const ids = new UuidV7IdGenerator();

  it("mints UUIDv7-shaped report ids", () => {
    expect(ids.reportId()).toMatch(UUID_V7_RE);
  });

  it("mints UUIDv7-shaped version ids", () => {
    expect(ids.versionId()).toMatch(UUID_V7_RE);
  });

  it("is unique across calls", () => {
    const seen = new Set([ids.reportId(), ids.reportId(), ids.versionId(), ids.versionId()]);
    expect(seen.size).toBe(4);
  });
});
