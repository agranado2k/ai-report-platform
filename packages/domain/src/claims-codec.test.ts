import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { makeClaimsCodec, type SlugBoundClaims } from "./claims-codec";
import { mintClaimsToken } from "./signed-token";

const SECRET = "test-secret-key-of-some-length";
const SLUG = "abcdefghij";
const NOW = 1_700_000_000; // fixed epoch seconds

/** A toy claims shape exercising the factory without depending on any real token type. */
interface ToyClaims extends SlugBoundClaims {
  readonly slug: string;
  readonly exp: number;
  readonly kind: "toy";
}

function parseToyClaims(raw: unknown): ToyClaims | null {
  if (typeof raw !== "object" || raw === null) return null;
  const claims = raw as Partial<ToyClaims>;
  if (typeof claims.slug !== "string" || typeof claims.exp !== "number") return null;
  if (claims.kind !== "toy") return null;
  return { slug: claims.slug, exp: claims.exp, kind: "toy" };
}

const codec = makeClaimsCodec({ parseClaims: parseToyClaims });
const toy = (overrides: Partial<ToyClaims> = {}): ToyClaims => ({
  slug: SLUG,
  exp: NOW + 900,
  kind: "toy",
  ...overrides,
});

describe("makeClaimsCodec (ADR-0073)", () => {
  it("round-trips minted claims for the expected slug within the TTL", () => {
    const t = codec.mint(toy(), SECRET);
    expect(codec.read(t, SLUG, SECRET, NOW + 60)).toEqual(toy());
  });

  it("mint is wire-format identical to mintClaimsToken (key order preserved verbatim)", () => {
    // The factory must not re-serialize or re-order claims — existing tokens on the
    // wire (cookies, links) were minted by mintClaimsToken directly and must keep
    // verifying byte-for-byte after the token modules move onto the factory.
    expect(codec.mint(toy(), SECRET)).toBe(mintClaimsToken(toy(), SECRET));
  });

  it("rejects a token minted for a different slug (slug binding lives in the factory)", () => {
    const t = codec.mint(toy(), SECRET);
    expect(codec.read(t, "zzzzzzzzzz", SECRET, NOW + 60)).toBeNull();
  });

  it("rejects an expired token, including exactly at the boundary (exp <= now)", () => {
    const t = codec.mint(toy(), SECRET);
    expect(codec.read(t, SLUG, SECRET, NOW + 900)).toBeNull();
    expect(codec.read(t, SLUG, SECRET, NOW + 901)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const t = codec.mint(toy(), SECRET);
    expect(codec.read(t, SLUG, "other-secret", NOW + 60)).toBeNull();
  });

  it("rejects a validly-signed payload the caller's parseClaims does not narrow", () => {
    // Same wire format, wrong vocabulary — the caller's narrow is the boundary.
    const payload = Buffer.from(
      JSON.stringify({ slug: SLUG, exp: NOW + 900, kind: "not-a-toy" }),
      "utf8",
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(codec.read(`${payload}.${sig}`, SLUG, SECRET, NOW)).toBeNull();
  });

  it("rejects malformed tokens without throwing", () => {
    expect(codec.read("garbage", SLUG, SECRET, NOW)).toBeNull();
    expect(codec.read("", SLUG, SECRET, NOW)).toBeNull();
    expect(codec.read(".sig", SLUG, SECRET, NOW)).toBeNull();
  });

  it("rejects a forged payload kept against another token's signature", () => {
    const sig = codec.mint(toy(), SECRET).split(".")[1];
    const forgedPayload = codec.mint(toy({ slug: "zzzzzzzzzz" }), SECRET).split(".")[0];
    expect(codec.read(`${forgedPayload}.${sig}`, "zzzzzzzzzz", SECRET, NOW + 60)).toBeNull();
  });
});
