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
});
