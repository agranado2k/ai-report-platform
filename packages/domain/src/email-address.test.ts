import { describe, expect, it } from "vitest";
import {
  isValidEmailFormat,
  makeEmailAddress,
  normalizeEmailAddress,
  normalizeEmailAddresses,
} from "./email-address";

describe("EmailAddress (ADR-0056)", () => {
  describe("normalizeEmailAddress", () => {
    it("trims + lowercases without validating shape", () => {
      expect(normalizeEmailAddress("  A@B.COM  ")).toBe("a@b.com");
      expect(normalizeEmailAddress("not-an-email")).toBe("not-an-email");
    });
  });

  describe("normalizeEmailAddresses", () => {
    it("trims + lowercases + dedupes + drops empties, order-preserving", () => {
      expect(normalizeEmailAddresses(["A@B.com", " c@d.io ", "a@b.com", "  ", ""])).toEqual([
        "a@b.com",
        "c@d.io",
      ]);
    });
  });

  describe("isValidEmailFormat", () => {
    it("accepts a plausible email", () => {
      expect(isValidEmailFormat("a@b.com")).toBe(true);
    });

    it("rejects missing @ / missing domain dot / whitespace", () => {
      expect(isValidEmailFormat("not-an-email")).toBe(false);
      expect(isValidEmailFormat("a@b")).toBe(false);
      expect(isValidEmailFormat("a @b.com")).toBe(false);
    });
  });

  describe("makeEmailAddress", () => {
    it("normalizes + validates in one step", () => {
      const r = makeEmailAddress("  A@B.COM  ");
      expect(r.ok && r.value).toBe("a@b.com");
    });

    it("rejects an invalid shape", () => {
      expect(makeEmailAddress("not-an-email").ok).toBe(false);
    });
  });
});
