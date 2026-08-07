// Property-based tests for the Slug Value Object (ADR-001/ADR-0038, ADR-0081).
//
// A Slug is a capability, not just an id (in `public` Acl mode the slug IS the
// access token — ADR-0038), so the smart constructor's accept/reject boundary is
// security-relevant: it must accept every real nanoid(10) and reject everything
// else, with no coercion or truncation in between.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makeSlug } from "./slug";

/** The nanoid default alphabet, exactly as `slug.ts` documents it. */
const NANOID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

const validSlug = fc
  .array(fc.constantFrom(...NANOID_ALPHABET.split("")), { minLength: 10, maxLength: 10 })
  .map((chars) => chars.join(""));

describe("Slug (ADR-0038) — properties", () => {
  it("accepts every nanoid(10) and returns it byte-identical (no coercion)", () => {
    fc.assert(
      fc.property(validSlug, (raw) => {
        const r = makeSlug(raw);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value).toBe(raw);
      }),
    );
  });

  it("rejects every length other than 10, however alphabet-clean", () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.constantFrom(...NANOID_ALPHABET.split("")), { minLength: 0, maxLength: 40 })
          .filter((chars) => chars.length !== 10)
          .map((chars) => chars.join("")),
        (raw) => {
          expect(makeSlug(raw).ok).toBe(false);
        },
      ),
    );
  });

  it("rejects any 10-char string containing a character outside the alphabet", () => {
    fc.assert(
      fc.property(
        validSlug,
        fc.integer({ min: 0, max: 9 }),
        fc.constantFrom(..."!@#$%^&*()+=[]{}|\\;:'\",.<>/?~` \t\n".split("")),
        (slug, at, bad) => {
          const tampered = `${slug.slice(0, at)}${bad}${slug.slice(at + 1)}`;
          expect(makeSlug(tampered).ok).toBe(false);
        },
      ),
    );
  });

  it("accepts exactly the strings matching the documented nanoid shape", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 15 }), (raw) => {
        expect(makeSlug(raw).ok).toBe(/^[A-Za-z0-9_-]{10}$/.test(raw));
      }),
    );
  });
});
