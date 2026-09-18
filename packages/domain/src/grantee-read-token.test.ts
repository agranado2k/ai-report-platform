import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mintAccessToken, readAccessToken } from "./access-token";
import { mintEditToken, readEditToken } from "./edit-token";
import { mintGranteeReadToken, readGranteeReadToken } from "./grantee-read-token";

const SECRET = "test-secret-key-of-some-length";
const SLUG = "abcdefghij";
const OTHER_SLUG = "zzzzzzzzzz";
const SUB = "user_2abc123";
const NOW = 1_700_000_000;

describe("grantee read token (ADR-0091)", () => {
  it("round-trips a freshly minted token for the same slug within its TTL", () => {
    const t = mintGranteeReadToken(SLUG, SUB, 900, SECRET, NOW);
    expect(readGranteeReadToken(t, SLUG, SECRET, NOW + 60)).toEqual({
      slug: SLUG,
      exp: NOW + 900,
      sub: SUB,
      scope: "granteeRead",
    });
  });

  it("rejects a token signed with a different secret", () => {
    const t = mintGranteeReadToken(SLUG, SUB, 900, SECRET, NOW);
    expect(readGranteeReadToken(t, SLUG, "other-secret", NOW + 60)).toBeNull();
  });

  it("rejects an expired token, and one exactly at the expiry boundary", () => {
    const t = mintGranteeReadToken(SLUG, SUB, 900, SECRET, NOW);
    expect(readGranteeReadToken(t, SLUG, SECRET, NOW + 900)).toBeNull();
    expect(readGranteeReadToken(t, SLUG, SECRET, NOW + 901)).toBeNull();
  });

  it("rejects a token minted for a different slug — single-report binding", () => {
    const t = mintGranteeReadToken(OTHER_SLUG, SUB, 900, SECRET, NOW);
    expect(readGranteeReadToken(t, SLUG, SECRET, NOW + 60)).toBeNull();
  });

  it("rejects a forged payload kept against an old signature", () => {
    const sig = mintGranteeReadToken(SLUG, SUB, 900, SECRET, NOW).split(".")[1];
    const forgedPayload = mintGranteeReadToken(OTHER_SLUG, SUB, 900, SECRET, NOW).split(".")[0];
    expect(
      readGranteeReadToken(`${forgedPayload}.${sig}`, OTHER_SLUG, SECRET, NOW + 60),
    ).toBeNull();
  });

  it("never yields an `owner` claim — the escalating field is unrepresentable in this shape", () => {
    const t = mintGranteeReadToken(SLUG, SUB, 900, SECRET, NOW);
    const claims = readGranteeReadToken(t, SLUG, SECRET, NOW + 60);
    expect(claims).not.toBeNull();
    expect(claims).not.toHaveProperty("owner");
    expect(claims).not.toHaveProperty("mode");
  });

  it("requires a NON-EMPTY sub — a read capability with no bound subject is not a capability", () => {
    const t = mintGranteeReadToken(SLUG, "", 900, SECRET, NOW);
    expect(readGranteeReadToken(t, SLUG, SECRET, NOW + 60)).toBeNull();
  });

  // --- The cross-parse boundary. This is the whole security argument of ADR-0091 §1:
  // three token types share one secret and one wire format, so the `scope` discriminant
  // has to keep them apart in BOTH directions, not just in effect.

  it("an owner:true Access token does NOT narrow into a grantee read token (review #146)", () => {
    const owner = mintAccessToken(SLUG, 86_400, SECRET, NOW, { owner: true });
    expect(readGranteeReadToken(owner, SLUG, SECRET, NOW + 60)).toBeNull();
  });

  it("an Edit token does NOT narrow into a grantee read token — a different scope is not this scope", () => {
    const edit = mintEditToken(SLUG, SUB, 900, SECRET, NOW);
    expect(readGranteeReadToken(edit, SLUG, SECRET, NOW + 60)).toBeNull();
  });

  it("a grantee read token does NOT narrow into an Access token — parseAccessClaims rejects any `scope`", () => {
    const gr = mintGranteeReadToken(SLUG, SUB, 900, SECRET, NOW);
    expect(readAccessToken(gr, SLUG, SECRET, NOW + 60)).toBeNull();
  });

  it("a grantee read token does NOT narrow into an Edit token — it grants no write anywhere", () => {
    const gr = mintGranteeReadToken(SLUG, SUB, 900, SECRET, NOW);
    expect(readEditToken(gr, SLUG, SECRET, NOW + 60)).toBeNull();
  });

  // --- The narrow, exercised on HAND-CRAFTED payloads (ADR-0081).
  //
  // Every test above reaches `parseGranteeReadClaims` through the TYPED mint or
  // by cross-parsing a real token, so TypeScript guarantees `slug` is a string
  // and `exp` a number before the guard ever runs — which means those two type
  // guards were never actually asserted, only the `sub` and `scope` ones. The
  // mutation run found exactly that: delete `typeof claims.exp !== "number"`
  // and the whole suite stayed green.
  //
  // That gap is not cosmetic. A validly-signed payload is all it takes — the
  // threat is not a forged signature but a wrong SHAPE on the wire from a mint
  // site or a fourth token type sharing the secret (ADR-0073). Sign these with
  // the REAL secret, so only the narrow stands between the payload and the
  // caller, exactly as `access-token.test.ts` does for its own guards.
  const signClaims = (claims: unknown): string => {
    const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    return `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
  };

  // THE ONE THAT MATTERS MOST. `exp` is checked downstream as
  // `claims.exp <= nowSeconds` (signed-token.ts). JavaScript coerces a numeric
  // STRING in that comparison, so `"9999999999"` compares as a number and the
  // check quietly passes — a token that never expires. ADR-0091 §4 rests its
  // entire revocation argument on the 15-minute bound ("the grantee's whole
  // session expires together and repairs through the app's one mint, where a
  // revoked grant is actually caught"), and §5 rejected a live `canWrite` check
  // on the view origin precisely BECAUSE the TTL already bounds revocation. If
  // `exp` can be a string, that bound is not enforced and the rejected
  // alternative was rejected on a false premise. The type guard is what makes
  // the argument true, so it gets its own test.
  it("rejects a non-numeric `exp` — the 15-minute bound ADR-0091 §4 rests on must be enforced", () => {
    const neverExpires = signClaims({
      slug: SLUG,
      exp: `${NOW + 900}`,
      sub: SUB,
      scope: "granteeRead",
    });
    expect(readGranteeReadToken(neverExpires, SLUG, SECRET, NOW + 60)).toBeNull();
    // And it stays rejected far beyond any legitimate TTL — the point is that
    // it never becomes a capability, not merely that it is late.
    expect(readGranteeReadToken(neverExpires, SLUG, SECRET, NOW + 86_400_000)).toBeNull();
  });

  it("rejects a non-string `slug` — the single-report binding is a string or it is nothing", () => {
    const t = signClaims({ slug: 42, exp: NOW + 900, sub: SUB, scope: "granteeRead" });
    expect(readGranteeReadToken(t, SLUG, SECRET, NOW + 60)).toBeNull();
  });

  // The codec's contract is "never throws" — it is called on attacker-supplied
  // cookie and query values on the credential-free origin, where an exception
  // is a 500 rather than a clean denial. A bare `null` payload is the sharp
  // case: without the `raw === null` guard, `claims.slug` throws rather than
  // returning null.
  it.each([
    ["null", null],
    ["a bare string", "granteeRead"],
    ["a number", 900],
    ["an array", [SLUG, NOW + 900, SUB, "granteeRead"]],
  ])("rejects %s as a payload without throwing", (_label, payload) => {
    expect(() => readGranteeReadToken(signClaims(payload), SLUG, SECRET, NOW + 60)).not.toThrow();
    expect(readGranteeReadToken(signClaims(payload), SLUG, SECRET, NOW + 60)).toBeNull();
  });

  // The `owner` key is DROPPED, not carried — ADR-0091 §1's "unrepresentable
  // rather than merely unset", asserted on the wire rather than in the type.
  // A hand-rolled payload is the only way to put one there at all, since the
  // mint's signature cannot express it.
  it("drops an `owner` key smuggled onto an otherwise valid payload", () => {
    const smuggled = signClaims({
      slug: SLUG,
      exp: NOW + 900,
      sub: SUB,
      scope: "granteeRead",
      owner: true,
    });
    const claims = readGranteeReadToken(smuggled, SLUG, SECRET, NOW + 60);
    expect(claims).toEqual({ slug: SLUG, exp: NOW + 900, sub: SUB, scope: "granteeRead" });
    expect(claims && "owner" in claims).toBe(false);
  });
});
