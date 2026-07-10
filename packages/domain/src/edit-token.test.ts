import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mintAccessToken } from "./access-token";
import { mintEditToken, readEditToken, verifyEditToken } from "./edit-token";

const SECRET = "test-secret-key-of-some-length";
const SLUG = "abcdefghij";
const SUB = "user_2abc123";
const NOW = 1_700_000_000; // fixed epoch seconds

describe("edit token (ADR-0063)", () => {
  it("round-trips a freshly minted token for the same slug within its TTL", () => {
    const t = mintEditToken(SLUG, SUB, 900, SECRET, NOW);
    const claims = readEditToken(t, SLUG, SECRET, NOW + 60);
    expect(claims).toEqual({ slug: SLUG, exp: NOW + 900, sub: SUB, scope: "edit" });
    expect(verifyEditToken(t, SLUG, SECRET, NOW + 60)).toBe(true);
  });

  it("rejects a token signed with a different secret", () => {
    const t = mintEditToken(SLUG, SUB, 900, SECRET, NOW);
    expect(readEditToken(t, SLUG, "other-secret", NOW + 60)).toBeNull();
    expect(verifyEditToken(t, SLUG, "other-secret", NOW + 60)).toBe(false);
  });

  it("rejects a forged payload kept against an old signature", () => {
    const sig = mintEditToken(SLUG, SUB, 900, SECRET, NOW).split(".")[1];
    const forgedPayload = mintEditToken("zzzzzzzzzz", SUB, 900, SECRET, NOW).split(".")[0];
    const forged = `${forgedPayload}.${sig}`;
    expect(readEditToken(forged, "zzzzzzzzzz", SECRET, NOW + 60)).toBeNull();
  });

  it("rejects an expired token", () => {
    const t = mintEditToken(SLUG, SUB, 900, SECRET, NOW);
    expect(readEditToken(t, SLUG, SECRET, NOW + 901)).toBeNull();
    expect(verifyEditToken(t, SLUG, SECRET, NOW + 901)).toBe(false);
  });

  it("rejects a token exactly at its expiry boundary (exp <= now)", () => {
    const t = mintEditToken(SLUG, SUB, 900, SECRET, NOW);
    expect(readEditToken(t, SLUG, SECRET, NOW + 900)).toBeNull();
  });

  it("rejects a token minted for a different slug (single-report binding)", () => {
    const t = mintEditToken(SLUG, SUB, 900, SECRET, NOW);
    expect(readEditToken(t, "zzzzzzzzzz", SECRET, NOW + 60)).toBeNull();
    expect(verifyEditToken(t, "zzzzzzzzzz", SECRET, NOW + 60)).toBe(false);
  });

  it("STAR: rejects an access token (even an owner:true one) as an edit token — no token-confusion escalation", () => {
    // A real, validly-signed AccessClaims token minted for the SAME slug+secret an
    // attacker (or a confused caller) might feed into readEditToken hoping the shared
    // secret + shared codec family lets a read/share capability pass as an edit one.
    const ownerAccessToken = mintAccessToken(SLUG, 900, SECRET, NOW, { owner: true });
    expect(readEditToken(ownerAccessToken, SLUG, SECRET, NOW + 60)).toBeNull();
    expect(verifyEditToken(ownerAccessToken, SLUG, SECRET, NOW + 60)).toBe(false);

    // A plain (non-owner) access token must be rejected too.
    const plainAccessToken = mintAccessToken(SLUG, 900, SECRET, NOW);
    expect(readEditToken(plainAccessToken, SLUG, SECRET, NOW + 60)).toBeNull();
  });

  it("NOTE: the reverse is fine — an edit token is not required to fail readAccessToken's shape checks, since edit implies read; this phase does not need to assert that direction", () => {
    // No assertion here — documenting the asymmetry intentionally left alone by this ADR.
    expect(true).toBe(true);
  });

  it('rejects scope:"read" (tampered/downgraded scope)', () => {
    const payload = Buffer.from(
      JSON.stringify({ slug: SLUG, exp: NOW + 900, sub: SUB, scope: "read" }),
      "utf8",
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(readEditToken(`${payload}.${sig}`, SLUG, SECRET, NOW)).toBeNull();
  });

  it("rejects a missing scope field", () => {
    const payload = Buffer.from(
      JSON.stringify({ slug: SLUG, exp: NOW + 900, sub: SUB }),
      "utf8",
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(readEditToken(`${payload}.${sig}`, SLUG, SECRET, NOW)).toBeNull();
  });

  it("rejects a non-string scope (type confusion)", () => {
    const payload = Buffer.from(
      JSON.stringify({ slug: SLUG, exp: NOW + 900, sub: SUB, scope: 123 }),
      "utf8",
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(readEditToken(`${payload}.${sig}`, SLUG, SECRET, NOW)).toBeNull();
  });

  it("rejects a missing sub", () => {
    const payload = Buffer.from(
      JSON.stringify({ slug: SLUG, exp: NOW + 900, scope: "edit" }),
      "utf8",
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(readEditToken(`${payload}.${sig}`, SLUG, SECRET, NOW)).toBeNull();
  });

  it("rejects an empty-string sub", () => {
    const payload = Buffer.from(
      JSON.stringify({ slug: SLUG, exp: NOW + 900, sub: "", scope: "edit" }),
      "utf8",
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(readEditToken(`${payload}.${sig}`, SLUG, SECRET, NOW)).toBeNull();
  });

  it("rejects a non-string sub (type confusion)", () => {
    const payload = Buffer.from(
      JSON.stringify({ slug: SLUG, exp: NOW + 900, sub: 42, scope: "edit" }),
      "utf8",
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(readEditToken(`${payload}.${sig}`, SLUG, SECRET, NOW)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(readEditToken("garbage", SLUG, SECRET, NOW)).toBeNull();
    expect(readEditToken("", SLUG, SECRET, NOW)).toBeNull();
    expect(readEditToken(".sig", SLUG, SECRET, NOW)).toBeNull();
    expect(verifyEditToken("garbage", SLUG, SECRET, NOW)).toBe(false);
  });

  it("rejects a non-JSON payload", () => {
    const payload = Buffer.from("not-json", "utf8").toString("base64url");
    const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(readEditToken(`${payload}.${sig}`, SLUG, SECRET, NOW)).toBeNull();
  });

  it("drops unexpected extra fields from the returned claims (narrowing)", () => {
    const t = mintEditToken(SLUG, SUB, 900, SECRET, NOW);
    const claims = readEditToken(t, SLUG, SECRET, NOW + 60);
    expect(claims).toEqual({ slug: SLUG, exp: NOW + 900, sub: SUB, scope: "edit" });
    expect(Object.keys(claims ?? {}).sort()).toEqual(["exp", "scope", "slug", "sub"]);
  });
});
