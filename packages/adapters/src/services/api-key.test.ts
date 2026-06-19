import { describe, expect, it } from "vitest";
import { ApiKeyService } from "./api-key";

describe("ApiKeyService", () => {
  const svc = new ApiKeyService({ pepper: "unit-test-pepper", label: "test" });

  it("mints a token with the `arp_<env>_` prefix, a 12-char lookup prefix, and a 64-hex hash", () => {
    const { token, prefix, hash } = svc.generate();
    expect(token.startsWith("arp_test_")).toBe(true);
    expect(prefix).toHaveLength(12);
    expect(prefix).toBe(token.slice(0, 12)); // prefix is derivable from a presented key
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stamps the configured environment label", () => {
    const live = new ApiKeyService({ pepper: "p", label: "live" });
    expect(live.generate().token.startsWith("arp_live_")).toBe(true);
  });

  it("verifies a freshly minted token against its own hash", () => {
    const { token, hash } = svc.generate();
    expect(svc.verify(token, hash)).toBe(true);
  });

  it("rejects a token that does not match the stored hash", () => {
    const { hash } = svc.generate();
    const other = svc.generate().token;
    expect(svc.verify(other, hash)).toBe(false);
  });

  it("binds the hash to the pepper — a different pepper does not verify", () => {
    const { token, hash } = svc.generate();
    const otherPepper = new ApiKeyService({ pepper: "a-different-pepper", label: "test" });
    expect(otherPepper.verify(token, hash)).toBe(false);
  });

  it("mints a unique secret on every call", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => svc.generate().token));
    expect(tokens.size).toBe(50);
  });

  it("derives the lookup prefix from a presented token", () => {
    const { token, prefix } = svc.generate();
    expect(svc.prefixOf(token)).toBe(prefix);
  });

  it("rejects a malformed hash without throwing (length-guarded constant-time compare)", () => {
    const { token } = svc.generate();
    expect(svc.verify(token, "deadbeef")).toBe(false);
  });

  it("fails closed when no pepper is configured: verify is false, minting throws", () => {
    const disabled = new ApiKeyService({ pepper: "" });
    expect(disabled.verify("arp_live_whatever", "0".repeat(64))).toBe(false);
    expect(() => disabled.generate()).toThrow(/API_KEY_PEPPER/);
  });
});
