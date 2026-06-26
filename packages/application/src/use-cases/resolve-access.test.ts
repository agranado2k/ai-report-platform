import { type Acl, mintAccessToken, reportId, verifyAccessToken } from "arp-domain";
import { describe, expect, it } from "vitest";
import { FixedClock, InMemoryGrantStore } from "../testing/in-memory";
import { type AccessDecision, resolveAccessDecision } from "./resolve-access";

const SECRET = "view-access-secret";
const SLUG = "abcdefghij";
const NOW = 1_700_000_000;
const RID = reportId("00000000-0000-7000-8000-0000000000a1");
const ALLOW: Acl = { mode: "allowlist", allowedEmails: ["a@b.com"], accessTtlSeconds: 3600 };

const newGrants = () => new InMemoryGrantStore(new FixedClock(NOW * 1000));

async function decide(
  acl: Acl,
  tokens: { cookie?: string; query?: string },
  opts: { grants?: InMemoryGrantStore; secret?: string; now?: number } = {},
): Promise<AccessDecision> {
  const r = await resolveAccessDecision(
    acl,
    RID,
    tokens,
    SLUG,
    opts.secret ?? SECRET,
    opts.now ?? NOW,
    opts.grants ?? newGrants(),
  );
  if (!r.ok) throw new Error("unexpected error result");
  return r.value;
}

describe("resolveAccessDecision (ADR-0056)", () => {
  it("a public report always serves (no token needed)", async () => {
    expect(await decide({ mode: "public" }, {})).toEqual({ kind: "serve" });
  });

  it("a private report with no token → unlock (redirect to the app)", async () => {
    expect(await decide({ mode: "org" }, {})).toEqual({ kind: "unlock" });
  });

  it("a valid ?access hand-off → grant (loader sets the unlock cookie) with maxAge", async () => {
    const token = mintAccessToken(SLUG, 900, SECRET, NOW);
    expect(await decide({ mode: "password", passwordHash: "h" }, { query: token })).toEqual({
      kind: "grant",
      token,
      maxAgeSeconds: 900,
    });
  });

  it("a valid unlock cookie → serve", async () => {
    expect(
      await decide(
        { mode: "password", passwordHash: "h" },
        { cookie: mintAccessToken(SLUG, 900, SECRET, NOW) },
      ),
    ).toEqual({ kind: "serve" });
  });

  it("an expired/invalid token → unlock (fails closed)", async () => {
    const expired = mintAccessToken(SLUG, 900, SECRET, NOW);
    expect(
      await decide(
        { mode: "password", passwordHash: "h" },
        { cookie: expired },
        { now: NOW + 901 },
      ),
    ).toEqual({
      kind: "unlock",
    });
    expect(await decide({ mode: "org" }, { query: "tampered.sig" })).toEqual({ kind: "unlock" });
  });

  it("fails closed when the secret is empty — an empty-HMAC forged token must not grant", async () => {
    const forged = mintAccessToken(SLUG, 900, "", NOW);
    expect(verifyAccessToken(forged, SLUG, "", NOW + 1)).toBe(true);
    expect(
      await decide(
        { mode: "password", passwordHash: "h" },
        { query: forged },
        { secret: "", now: NOW + 1 },
      ),
    ).toEqual({ kind: "unlock" });
  });

  it("a token minted for a different slug does not unlock this one", async () => {
    const other = mintAccessToken("zzzzzzzzzz", 900, SECRET, NOW);
    expect(await decide({ mode: "org" }, { cookie: other, query: other })).toEqual({
      kind: "unlock",
    });
  });

  // ── allowlist / revocation-C ──────────────────────────────────────────────
  it("allowlist: valid token + LIVE grant → grant (cookie maxAge = grant TTL)", async () => {
    const grants = newGrants();
    await grants.grant(RID, "a@b.com", (NOW + 3600) * 1000);
    const token = mintAccessToken(SLUG, 3600, SECRET, NOW, "a@b.com");
    expect(await decide(ALLOW, { query: token }, { grants })).toEqual({
      kind: "grant",
      token,
      maxAgeSeconds: 3600,
    });
  });

  it("allowlist: valid token but NO live grant → unlock (revoked since mint)", async () => {
    const token = mintAccessToken(SLUG, 3600, SECRET, NOW, "a@b.com");
    expect(await decide(ALLOW, { cookie: token })).toEqual({ kind: "unlock" }); // no grant seeded
  });

  it("allowlist: a token carrying no email claim → unlock", async () => {
    const grants = newGrants();
    await grants.grant(RID, "a@b.com", (NOW + 3600) * 1000);
    const token = mintAccessToken(SLUG, 3600, SECRET, NOW); // no email
    expect(await decide(ALLOW, { cookie: token }, { grants })).toEqual({ kind: "unlock" });
  });
});
