import { describe, expect, it } from "vitest";
import { mintAccessToken, verifyAccessToken } from "./access-token";

const SECRET = "test-secret-key-of-some-length";
const SLUG = "abcdefghij";
const NOW = 1_700_000_000; // fixed epoch seconds

describe("access token (ADR-0056)", () => {
  it("verifies a freshly minted token for the same slug within its TTL", () => {
    const t = mintAccessToken(SLUG, 900, SECRET, NOW);
    expect(verifyAccessToken(t, SLUG, SECRET, NOW + 60)).toBe(true);
  });

  it("rejects a token minted for a different slug (slug-bound)", () => {
    const t = mintAccessToken(SLUG, 900, SECRET, NOW);
    expect(verifyAccessToken(t, "zzzzzzzzzz", SECRET, NOW + 60)).toBe(false);
  });

  it("rejects an expired token", () => {
    const t = mintAccessToken(SLUG, 900, SECRET, NOW);
    expect(verifyAccessToken(t, SLUG, SECRET, NOW + 901)).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const t = mintAccessToken(SLUG, 900, SECRET, NOW);
    expect(verifyAccessToken(t, SLUG, "other-secret", NOW + 60)).toBe(false);
  });

  it("rejects a forged payload kept against an old signature", () => {
    const sig = mintAccessToken(SLUG, 900, SECRET, NOW).split(".")[1];
    const forgedPayload = mintAccessToken("zzzzzzzzzz", 900, SECRET, NOW).split(".")[0];
    const forged = `${forgedPayload}.${sig}`;
    expect(verifyAccessToken(forged, "zzzzzzzzzz", SECRET, NOW + 60)).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(verifyAccessToken("garbage", SLUG, SECRET, NOW)).toBe(false);
    expect(verifyAccessToken("", SLUG, SECRET, NOW)).toBe(false);
    expect(verifyAccessToken(".sig", SLUG, SECRET, NOW)).toBe(false);
  });
});
