// Behavior tests for resolveEditAccess — the pure decision behind
// GET /<slug>/edit's auth seam (ADR-0063 Decision 3/4 implementation). Mirrors
// resolveAccessDecision's testing style (packages/application/src/use-cases/
// resolve-access.test.ts): mint real tokens with mintEditToken, then assert the
// decision, never hand-rolling a token string.
import { mintEditToken } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  buildEditCookie,
  degradeLocation,
  EDIT_COOKIE_NAME,
  readEditCookieValue,
  resolveEditAccess,
} from "./edit-session";

const SECRET = "test-secret";
const SLUG = "abc1234567";
const NOW = 1_700_000_000;

function mint(ttlSeconds: number, sub = "user_1", nowSeconds = NOW): string {
  return mintEditToken(SLUG, sub, ttlSeconds, SECRET, nowSeconds);
}

describe("resolveEditAccess", () => {
  it("denies when no token is present at all", () => {
    const decision = resolveEditAccess({
      queryToken: undefined,
      cookieToken: undefined,
      slug: SLUG,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(decision).toEqual({ kind: "denied" });
  });

  it("denies (fails closed) when no secret is configured, even with a well-formed token", () => {
    const token = mint(900);
    const decision = resolveEditAccess({
      queryToken: token,
      cookieToken: undefined,
      slug: SLUG,
      secret: undefined,
      nowSeconds: NOW,
    });
    expect(decision).toEqual({ kind: "denied" });
  });

  it("a valid ?et= query token → set-cookie, carrying the token + remaining TTL", () => {
    const token = mint(900);
    const decision = resolveEditAccess({
      queryToken: token,
      cookieToken: undefined,
      slug: SLUG,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(decision).toEqual({ kind: "set-cookie", token, maxAgeSeconds: 900 });
  });

  it("an expired query token → denied", () => {
    const token = mint(900);
    const decision = resolveEditAccess({
      queryToken: token,
      cookieToken: undefined,
      slug: SLUG,
      secret: SECRET,
      nowSeconds: NOW + 901,
    });
    expect(decision).toEqual({ kind: "denied" });
  });

  it("a malformed/forged query token → denied", () => {
    const decision = resolveEditAccess({
      queryToken: "not-a-real-token",
      cookieToken: undefined,
      slug: SLUG,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(decision).toEqual({ kind: "denied" });
  });

  it("a query token minted for a different slug → denied (slug binding enforced)", () => {
    const token = mintEditToken("zzzzzzzzzz", "user_1", 900, SECRET, NOW);
    const decision = resolveEditAccess({
      queryToken: token,
      cookieToken: undefined,
      slug: SLUG,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(decision).toEqual({ kind: "denied" });
  });

  it("a valid arp_edit cookie token (no query token) → render, carrying the claims", () => {
    const token = mint(900);
    const decision = resolveEditAccess({
      queryToken: undefined,
      cookieToken: token,
      slug: SLUG,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(decision.kind).toBe("render");
    if (decision.kind === "render") {
      expect(decision.token).toBe(token);
      expect(decision.claims).toEqual({
        slug: SLUG,
        exp: NOW + 900,
        sub: "user_1",
        scope: "edit",
        sessionStart: NOW,
      });
    }
  });

  it("an expired cookie token → denied (the fallback-to-public-viewer path)", () => {
    const token = mint(900);
    const decision = resolveEditAccess({
      queryToken: undefined,
      cookieToken: token,
      slug: SLUG,
      secret: SECRET,
      nowSeconds: NOW + 901,
    });
    expect(decision).toEqual({ kind: "denied" });
  });

  it("prefers a fresh ?et= query token over a stale cookie when both are present", () => {
    const staleCookie = mint(900, "user_1", NOW - 1000); // already expired by NOW
    const freshQuery = mint(900);
    const decision = resolveEditAccess({
      queryToken: freshQuery,
      cookieToken: staleCookie,
      slug: SLUG,
      secret: SECRET,
      nowSeconds: NOW,
    });
    expect(decision).toEqual({ kind: "set-cookie", token: freshQuery, maxAgeSeconds: 900 });
  });
});

describe("degradeLocation — hotfix: an owner degrade never lands on the unlock wall", () => {
  it("no `oa` → the current bare public-viewer fallback, unchanged", () => {
    expect(degradeLocation(SLUG, undefined)).toBe(`/${SLUG}`);
  });

  it("`oa` present → routes through the viewer's existing `?access=` owner flow, URL-encoded", () => {
    const oa = "owner.token.with/special+chars";
    expect(degradeLocation(SLUG, oa)).toBe(`/${SLUG}?access=${encodeURIComponent(oa)}`);
  });
});

describe("buildEditCookie", () => {
  it("builds an HttpOnly, Secure, SameSite=Lax cookie scoped to /<slug>/edit", () => {
    const cookie = buildEditCookie(SLUG, "tok123", 900);
    expect(cookie).toBe(
      `${EDIT_COOKIE_NAME}=tok123; Path=/${SLUG}/edit; Max-Age=900; HttpOnly; Secure; SameSite=Lax`,
    );
  });
});

describe("readEditCookieValue", () => {
  it("returns undefined for a null Cookie header", () => {
    expect(readEditCookieValue(null)).toBeUndefined();
  });

  it("returns undefined when the cookie header has no arp_edit entry", () => {
    expect(readEditCookieValue("other=1; another=2")).toBeUndefined();
  });

  it("extracts arp_edit from a multi-cookie header", () => {
    expect(readEditCookieValue(`foo=bar; ${EDIT_COOKIE_NAME}=tok123; baz=qux`)).toBe("tok123");
  });
});
