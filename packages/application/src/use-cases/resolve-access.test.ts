import { type Acl, mintAccessToken, reportId, verifyAccessToken } from "arp-domain";
import { describe, expect, it } from "vitest";
import { FixedClock, InMemoryGrantStore } from "../testing/in-memory";
import { type AccessDecision, resolveAccessDecision } from "./resolve-access";

const SECRET = "view-access-secret";
const SLUG = "abcdefghij";
const NOW = 1_700_000_000;
const RID = reportId("00000000-0000-7000-8000-0000000000a1");
const PW: Acl = { mode: "password", passwordHash: "h" };
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
    const token = mintAccessToken(SLUG, 900, SECRET, NOW, { mode: "password" });
    expect(await decide(PW, { query: token })).toEqual({
      kind: "grant",
      token,
      maxAgeSeconds: 900,
    });
  });

  it("a valid unlock cookie → serve", async () => {
    expect(
      await decide(PW, { cookie: mintAccessToken(SLUG, 900, SECRET, NOW, { mode: "password" }) }),
    ).toEqual({
      kind: "serve",
    });
  });

  it("an expired/invalid token → unlock (fails closed)", async () => {
    const expired = mintAccessToken(SLUG, 900, SECRET, NOW, { mode: "password" });
    expect(await decide(PW, { cookie: expired }, { now: NOW + 901 })).toEqual({ kind: "unlock" });
    expect(await decide({ mode: "org" }, { query: "tampered.sig" })).toEqual({ kind: "unlock" });
  });

  it("fails closed when the secret is empty — an empty-HMAC forged token must not grant", async () => {
    const forged = mintAccessToken(SLUG, 900, "", NOW, { mode: "password" });
    expect(verifyAccessToken(forged, SLUG, "", NOW + 1)).toBe(true);
    expect(await decide(PW, { query: forged }, { secret: "", now: NOW + 1 })).toEqual({
      kind: "unlock",
    });
  });

  it("a token minted for a different slug does not unlock this one", async () => {
    const other = mintAccessToken("zzzzzzzzzz", 900, SECRET, NOW, { mode: "org" });
    expect(await decide({ mode: "org" }, { cookie: other, query: other })).toEqual({
      kind: "unlock",
    });
  });

  it("a token minted under a different mode → unlock (mode-bound; no cross-mode bypass)", async () => {
    // An allowlist cookie must NOT serve a report the owner has since switched to password.
    const grants = newGrants();
    await grants.grant(RID, "a@b.com", (NOW + 3600) * 1000); // grant still live
    const allowToken = mintAccessToken(SLUG, 3600, SECRET, NOW, {
      mode: "allowlist",
      email: "a@b.com",
    });
    expect(await decide(PW, { cookie: allowToken }, { grants })).toEqual({ kind: "unlock" });
  });

  // ── private (owner-only) mode (ADR-0056) ──────────────────────────────────
  it("private report: owner token serves; everyone else → unlock", async () => {
    const PRIV: Acl = { mode: "private" };
    const owner = mintAccessToken(SLUG, 86_400, SECRET, NOW, { owner: true });
    expect(await decide(PRIV, { cookie: owner })).toEqual({ kind: "serve" });
    // no token → unlock; a non-owner (e.g. a password-mode) token → unlock (mode-bound)
    expect(await decide(PRIV, {})).toEqual({ kind: "unlock" });
    const pwToken = mintAccessToken(SLUG, 900, SECRET, NOW, { mode: "password" });
    expect(await decide(PRIV, { cookie: pwToken })).toEqual({ kind: "unlock" });
  });

  // ── owner access (ADR-0056) ───────────────────────────────────────────────
  it("owner token serves a password report without the password (cookie → serve)", async () => {
    const owner = mintAccessToken(SLUG, 86_400, SECRET, NOW, { owner: true });
    expect(await decide(PW, { cookie: owner })).toEqual({ kind: "serve" });
  });

  it("owner token serves an allowlist report with NO grant + email not on the list (?access → grant)", async () => {
    const owner = mintAccessToken(SLUG, 86_400, SECRET, NOW, { owner: true });
    expect(await decide(ALLOW, { query: owner })).toEqual({
      kind: "grant",
      token: owner,
      maxAgeSeconds: 86_400,
    });
  });

  it("owner bypass still respects slug-binding, expiry, and the empty-secret fail-closed", async () => {
    const owner = mintAccessToken(SLUG, 86_400, SECRET, NOW, { owner: true });
    expect(await decide(PW, { cookie: owner }, { now: NOW + 86_401 })).toEqual({ kind: "unlock" }); // expired
    const otherSlug = mintAccessToken("zzzzzzzzzz", 86_400, SECRET, NOW, { owner: true });
    expect(await decide(PW, { cookie: otherSlug })).toEqual({ kind: "unlock" }); // wrong slug
    expect(await decide(PW, { cookie: owner }, { secret: "" })).toEqual({ kind: "unlock" }); // no secret
  });

  // ── allowlist / revocation-C ──────────────────────────────────────────────
  it("allowlist: valid token + LIVE grant → grant (cookie maxAge = grant TTL)", async () => {
    const grants = newGrants();
    await grants.grant(RID, "a@b.com", (NOW + 3600) * 1000);
    const token = mintAccessToken(SLUG, 3600, SECRET, NOW, { mode: "allowlist", email: "a@b.com" });
    expect(await decide(ALLOW, { query: token }, { grants })).toEqual({
      kind: "grant",
      token,
      maxAgeSeconds: 3600,
    });
  });

  it("allowlist: valid token but NO live grant → unlock (revoked since mint)", async () => {
    const token = mintAccessToken(SLUG, 3600, SECRET, NOW, { mode: "allowlist", email: "a@b.com" });
    expect(await decide(ALLOW, { cookie: token })).toEqual({ kind: "unlock" }); // no grant seeded
  });

  it("allowlist: email removed from the allowlist → unlock even with a live grant", async () => {
    const grants = newGrants();
    await grants.grant(RID, "a@b.com", (NOW + 3600) * 1000); // grant still live (5e hasn't pruned it)
    const token = mintAccessToken(SLUG, 3600, SECRET, NOW, { mode: "allowlist", email: "a@b.com" });
    const removed: Acl = {
      mode: "allowlist",
      allowedEmails: ["someone@x.com"],
      accessTtlSeconds: 3600,
    };
    expect(await decide(removed, { cookie: token }, { grants })).toEqual({ kind: "unlock" });
  });

  it("allowlist: a token carrying no email claim → unlock", async () => {
    const grants = newGrants();
    await grants.grant(RID, "a@b.com", (NOW + 3600) * 1000);
    const token = mintAccessToken(SLUG, 3600, SECRET, NOW, { mode: "allowlist" }); // no email
    expect(await decide(ALLOW, { cookie: token }, { grants })).toEqual({ kind: "unlock" });
  });
});
