import { mintAccessToken, verifyAccessToken } from "arp-domain";
import { describe, expect, it } from "vitest";
import { resolveAccessDecision } from "./resolve-access";

const SECRET = "view-access-secret";
const SLUG = "abcdefghij";
const NOW = 1_700_000_000;
const valid = () => mintAccessToken(SLUG, 900, SECRET, NOW);

describe("resolveAccessDecision (ADR-0056)", () => {
  it("a public report always serves (no token needed)", () => {
    expect(resolveAccessDecision({ mode: "public" }, {}, SLUG, SECRET, NOW)).toEqual({
      kind: "serve",
    });
  });

  it("a private report with no token → unlock (redirect to the app)", () => {
    expect(resolveAccessDecision({ mode: "org" }, {}, SLUG, SECRET, NOW)).toEqual({
      kind: "unlock",
    });
  });

  it("a valid ?access hand-off → grant (loader sets the unlock cookie)", () => {
    const token = valid();
    expect(
      resolveAccessDecision(
        { mode: "password", passwordHash: "h" },
        { query: token },
        SLUG,
        SECRET,
        NOW,
      ),
    ).toEqual({ kind: "grant", token });
  });

  it("a valid unlock cookie → serve", () => {
    expect(
      resolveAccessDecision(
        { mode: "password", passwordHash: "h" },
        { cookie: valid() },
        SLUG,
        SECRET,
        NOW,
      ),
    ).toEqual({ kind: "serve" });
  });

  it("an expired/invalid token → unlock (fails closed)", () => {
    const expired = mintAccessToken(SLUG, 900, SECRET, NOW);
    expect(
      resolveAccessDecision(
        { mode: "password", passwordHash: "h" },
        { cookie: expired },
        SLUG,
        SECRET,
        NOW + 901,
      ),
    ).toEqual({ kind: "unlock" });
    expect(
      resolveAccessDecision({ mode: "org" }, { query: "tampered.sig" }, SLUG, SECRET, NOW),
    ).toEqual({ kind: "unlock" });
  });

  it("fails closed when the secret is empty — an empty-HMAC forged token must not grant", () => {
    // Node's createHmac("sha256","") is valid, so a token forged under the empty
    // secret WOULD verify — proving the gate can't rely on verify alone.
    const forged = mintAccessToken(SLUG, 900, "", NOW);
    expect(verifyAccessToken(forged, SLUG, "", NOW + 1)).toBe(true);
    // But the decision fails closed because the secret is unset (claude-review #100).
    expect(
      resolveAccessDecision(
        { mode: "password", passwordHash: "h" },
        { query: forged },
        SLUG,
        "",
        NOW + 1,
      ),
    ).toEqual({ kind: "unlock" });
  });

  it("a token minted for a different slug does not unlock this one", () => {
    const other = mintAccessToken("zzzzzzzzzz", 900, SECRET, NOW);
    expect(
      resolveAccessDecision({ mode: "org" }, { cookie: other, query: other }, SLUG, SECRET, NOW),
    ).toEqual({ kind: "unlock" });
  });
});
