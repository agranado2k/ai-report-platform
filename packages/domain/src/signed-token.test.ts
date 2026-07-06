import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  mintClaimsToken,
  mintSignedToken,
  readClaimsToken,
  readSignedTokenPayload,
  signPayload,
} from "./signed-token";

const SECRET = "test-secret-key-of-some-length";
const NOW = 1_700_000_000;

describe("signed-token codec (ADR-0056)", () => {
  describe("mintSignedToken / readSignedTokenPayload (raw payload, e.g. magic-link nonce)", () => {
    it("round-trips an arbitrary raw payload", () => {
      const t = mintSignedToken("some-nonce-id", SECRET);
      expect(readSignedTokenPayload(t, SECRET)).toBe("some-nonce-id");
    });

    it("produces base64url(payload) + '.' + HMAC-SHA256(payload, secret)", () => {
      const t = mintSignedToken("some-nonce-id", SECRET);
      const dot = t.indexOf(".");
      const payload = t.slice(0, dot);
      const sig = t.slice(dot + 1);
      expect(Buffer.from(payload, "base64url").toString("utf8")).toBe("some-nonce-id");
      expect(sig).toBe(createHmac("sha256", SECRET).update(payload).digest("base64url"));
    });

    it("rejects a token signed with a different secret", () => {
      const t = mintSignedToken("some-nonce-id", SECRET);
      expect(readSignedTokenPayload(t, "other-secret")).toBeNull();
    });

    it("rejects a tampered payload kept against an old signature", () => {
      const sig = mintSignedToken("a", SECRET).split(".")[1];
      const forgedPayload = mintSignedToken("b", SECRET).split(".")[0];
      expect(readSignedTokenPayload(`${forgedPayload}.${sig}`, SECRET)).toBeNull();
    });

    it("rejects malformed tokens (no dot, empty payload, empty string)", () => {
      expect(readSignedTokenPayload("garbage", SECRET)).toBeNull();
      expect(readSignedTokenPayload("", SECRET)).toBeNull();
      expect(readSignedTokenPayload(".sig", SECRET)).toBeNull();
    });

    it("never throws on a signature of mismatched length (constant-time guard)", () => {
      const t = mintSignedToken("a", SECRET);
      const [payload] = t.split(".");
      expect(() => readSignedTokenPayload(`${payload}.short`, SECRET)).not.toThrow();
      expect(readSignedTokenPayload(`${payload}.short`, SECRET)).toBeNull();
    });
  });

  describe("mintClaimsToken / readClaimsToken (JSON claims + expiry)", () => {
    interface TestClaims {
      readonly exp: number;
      readonly sub: string;
    }
    const parseTestClaims = (raw: unknown): TestClaims | null => {
      if (typeof raw !== "object" || raw === null) return null;
      const c = raw as Partial<TestClaims>;
      if (typeof c.exp !== "number" || typeof c.sub !== "string") return null;
      return { exp: c.exp, sub: c.sub };
    };

    it("round-trips claims within their TTL", () => {
      const t = mintClaimsToken({ exp: NOW + 900, sub: "abc" }, SECRET);
      expect(readClaimsToken(t, SECRET, NOW + 60, parseTestClaims)).toEqual({
        exp: NOW + 900,
        sub: "abc",
      });
    });

    it("rejects an expired token", () => {
      const t = mintClaimsToken({ exp: NOW + 900, sub: "abc" }, SECRET);
      expect(readClaimsToken(t, SECRET, NOW + 901, parseTestClaims)).toBeNull();
    });

    it("treats exp == now as expired (strict less-than)", () => {
      const t = mintClaimsToken({ exp: NOW + 900, sub: "abc" }, SECRET);
      expect(readClaimsToken(t, SECRET, NOW + 900, parseTestClaims)).toBeNull();
    });

    it("rejects claims that don't parse to the caller's shape", () => {
      const t = mintClaimsToken({ exp: NOW + 900, sub: 123 } as unknown as TestClaims, SECRET);
      expect(readClaimsToken(t, SECRET, NOW, parseTestClaims)).toBeNull();
    });

    it("rejects a forged signature before even attempting to parse claims", () => {
      const t = mintClaimsToken({ exp: NOW + 900, sub: "abc" }, SECRET);
      expect(readClaimsToken(t, "other-secret", NOW, parseTestClaims)).toBeNull();
    });

    it("rejects malformed / non-JSON payloads", () => {
      const t = mintSignedToken("not-json", SECRET);
      expect(readClaimsToken(t, SECRET, NOW, parseTestClaims)).toBeNull();
    });
  });

  describe("signPayload", () => {
    it("is deterministic for the same payload + secret", () => {
      expect(signPayload("x", SECRET)).toBe(signPayload("x", SECRET));
    });

    it("differs across secrets", () => {
      expect(signPayload("x", SECRET)).not.toBe(signPayload("x", "different-secret"));
    });
  });
});
