import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mintAccessToken, readAccessToken } from "./access-token";
import { mintEditToken, readEditToken, verifyEditToken } from "./edit-token";

const SECRET = "test-secret-key-of-some-length";
const SLUG = "abcdefghij";
const SUB = "user_2abc123";
const NOW = 1_700_000_000; // fixed epoch seconds

describe("edit token (ADR-0063)", () => {
  it("round-trips a freshly minted token for the same slug within its TTL", () => {
    const t = mintEditToken(SLUG, SUB, 900, SECRET, NOW);
    const claims = readEditToken(t, SLUG, SECRET, NOW + 60);
    expect(claims).toEqual({
      slug: SLUG,
      exp: NOW + 900,
      sub: SUB,
      scope: "edit",
      sessionStart: NOW,
    });
    expect(verifyEditToken(t, SLUG, SECRET, NOW + 60)).toBe(true);
  });

  it("mintEditToken defaults sessionStart to nowSeconds — a fresh mint starts a fresh session", () => {
    const t = mintEditToken(SLUG, SUB, 900, SECRET, NOW);
    const claims = readEditToken(t, SLUG, SECRET, NOW + 60);
    expect(claims?.sessionStart).toBe(NOW);
  });

  it("mintEditToken honors an explicit sessionStartSeconds — a refresh carries the ORIGINAL start forward, not now", () => {
    const originalSessionStart = NOW - 3600; // an hour into an existing session
    const t = mintEditToken(SLUG, SUB, 900, SECRET, NOW, originalSessionStart);
    const claims = readEditToken(t, SLUG, SECRET, NOW + 60);
    expect(claims?.sessionStart).toBe(originalSessionStart);
    expect(claims?.exp).toBe(NOW + 900); // exp still anchors on THIS mint's now, only sessionStart is carried
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

  it("the reverse is safe — an edit token reads as a plain NON-owner access claim (no owner escalation)", () => {
    // Edit implies read, so an edit token IS readable on the access path — but it must
    // confer only ordinary, ACL-gated read: NO `owner` bypass, and the edit-only fields
    // (`sub`/`scope`) dropped. Locks in the OTHER half of the no-confusion guarantee.
    const editToken = mintEditToken(SLUG, SUB, 900, SECRET, NOW);
    const asAccess = readAccessToken(editToken, SLUG, SECRET, NOW + 60);
    expect(asAccess).toEqual({ slug: SLUG, exp: NOW + 900 }); // no owner, no sub, no scope
    expect(asAccess?.owner).toBeUndefined();
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
    expect(claims).toEqual({
      slug: SLUG,
      exp: NOW + 900,
      sub: SUB,
      scope: "edit",
      sessionStart: NOW,
    });
    expect(Object.keys(claims ?? {}).sort()).toEqual([
      "exp",
      "scope",
      "sessionStart",
      "slug",
      "sub",
    ]);
  });

  describe("sessionStart backward-compat (ADR-0063 absolute session cap)", () => {
    it("a legacy token minted with NO sessionStart field still round-trips and authenticates", () => {
      const payload = Buffer.from(
        JSON.stringify({ slug: SLUG, exp: NOW + 900, sub: SUB, scope: "edit" }),
        "utf8",
      ).toString("base64url");
      const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
      const legacyToken = `${payload}.${sig}`;

      const claims = readEditToken(legacyToken, SLUG, SECRET, NOW + 60);
      expect(claims).toEqual({ slug: SLUG, exp: NOW + 900, sub: SUB, scope: "edit" });
      expect(claims?.sessionStart).toBeUndefined();
      expect("sessionStart" in (claims ?? {})).toBe(false);
      expect(verifyEditToken(legacyToken, SLUG, SECRET, NOW + 60)).toBe(true);
    });

    it("rejects a non-number sessionStart (type confusion)", () => {
      const payload = Buffer.from(
        JSON.stringify({
          slug: SLUG,
          exp: NOW + 900,
          sub: SUB,
          scope: "edit",
          sessionStart: "not-a-number",
        }),
        "utf8",
      ).toString("base64url");
      const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
      expect(readEditToken(`${payload}.${sig}`, SLUG, SECRET, NOW)).toBeNull();
    });

    it("tampering with sessionStart breaks the signature — it's inside the signed payload", () => {
      const t = mintEditToken(SLUG, SUB, 900, SECRET, NOW, NOW - 3600);
      const dot = t.indexOf(".");
      const payload = t.slice(0, dot);
      const sig = t.slice(dot + 1);
      const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      // An attacker tries to reset their session clock to "now" to dodge the cap.
      const tamperedPayload = Buffer.from(
        JSON.stringify({ ...decoded, sessionStart: NOW }),
        "utf8",
      ).toString("base64url");
      const tampered = `${tamperedPayload}.${sig}`; // old signature over the new payload
      expect(readEditToken(tampered, SLUG, SECRET, NOW + 60)).toBeNull();
    });
  });
});
