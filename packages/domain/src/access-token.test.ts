import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mintAccessToken, readAccessToken, verifyAccessToken } from "./access-token";

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

  it("round-trips the owner claim (ADR-0056 owner access)", () => {
    const t = mintAccessToken(SLUG, 86_400, SECRET, NOW, { owner: true });
    const claims = readAccessToken(t, SLUG, SECRET, NOW + 60);
    expect(claims?.owner).toBe(true);
  });

  it("omits owner when not set (no false-y claim on a normal token)", () => {
    const claims = readAccessToken(mintAccessToken(SLUG, 900, SECRET, NOW), SLUG, SECRET, NOW + 60);
    expect(claims?.owner).toBeUndefined();
  });

  // Sign an arbitrary claims payload with the REAL secret: the signature is
  // valid, so only `parseAccessClaims`'s narrow stands between the payload and
  // the caller. This is how a mistyped claim gets in — not by forging a
  // signature, but by a mint site (or a second token type sharing the secret,
  // ADR-0073) putting the wrong shape on the wire.
  const signClaims = (claims: unknown): string => {
    const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    return `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
  };

  // ADR-0081 mutation finding: every type guard in `parseAccessClaims` except
  // the `owner` one survived mutation — deleting them (`if (false) return null`)
  // broke no test. The module doc promises "same rejection of a mistyped
  // mode/email/owner"; only one third of that promise was enforced. `mode` is
  // the revocation-C binding (a stale cookie must not survive an Acl mode
  // switch, ADR-0056), so a non-string `mode` slipping through means the
  // viewer's mode comparison silently stops discriminating.
  it.each([
    ["a non-string mode (the revocation-C Acl-mode binding)", { mode: 42 }],
    ["a non-string email (the allowlist grant key)", { email: { addr: "a@b.com" } }],
    ["a non-boolean owner (the share-gate bypass claim)", { owner: "yes" }],
    ["a non-string slug", { slug: 12345 }],
    ["a non-numeric exp", { exp: "9999999999" }],
  ])("rejects a validly signed Access token carrying %s", (_label, override) => {
    const token = signClaims({ slug: SLUG, exp: NOW + 900, ...override });
    expect(readAccessToken(token, SLUG, SECRET, NOW)).toBeNull();
  });

  it.each([
    ["null", null],
    ["a bare string", "not-an-object"],
    ["a number", 7],
    ["an array", [{ slug: SLUG, exp: NOW + 900 }]],
  ])("rejects a validly signed payload that is %s rather than a claims object", (_label, raw) => {
    expect(readAccessToken(signClaims(raw), SLUG, SECRET, NOW)).toBeNull();
  });

  it("drops unknown claims instead of forwarding them, and omits absent optional ones", () => {
    // The narrow returns ONLY its known vocabulary — an attacker-supplied extra
    // field never reaches a caller, and an absent optional claim stays absent
    // (not present-as-undefined, which would read as "carried, but empty").
    const claims = readAccessToken(
      signClaims({ slug: SLUG, exp: NOW + 900, admin: true, mode: "password" }),
      SLUG,
      SECRET,
      NOW,
    );
    expect(claims).not.toBeNull();
    expect(Object.keys(claims ?? {}).sort()).toEqual(["exp", "mode", "slug"]);
  });

  it("returns only slug + exp for a token carrying no optional claims", () => {
    // The absent optional claims must be ABSENT, not present-as-undefined: a
    // `mode` key holding `undefined` would compare equal to a missing mode at
    // every `claims.mode === …` site while still reading as "the token carried
    // a mode", which is the opposite of the revocation-C binding's intent.
    const claims = readAccessToken(mintAccessToken(SLUG, 900, SECRET, NOW), SLUG, SECRET, NOW + 60);
    expect(Object.keys(claims ?? {}).sort()).toEqual(["exp", "slug"]);
  });
});
