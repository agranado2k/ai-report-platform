// Property-based tests for the EmailAddress Value Object (ADR-0056, ADR-0081).
//
// `normalizeEmailAddresses` is the ONE normalization home for the `Acl`'s
// allowlist and the `Write grant` key — the three-way drift bug that motivated
// extracting it (claude-review #114) was exactly the kind of defect an
// example-based test misses and a property catches: two call sites agreeing on
// the examples someone wrote down, disagreeing everywhere else. So the laws are
// stated over arbitrary input rather than over a fixture list.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  isValidEmailFormat,
  makeEmailAddress,
  normalizeEmailAddress,
  normalizeEmailAddresses,
} from "./email-address";

/** Realistic-ish inputs: real addresses, the same addresses wearing whitespace
 *  and mixed case, plus junk — the allowlist field is untrusted paste-in text. */
const messyEmail = fc.oneof(
  fc.emailAddress(),
  fc.emailAddress().map((e) => `  ${e.toUpperCase()} `),
  fc.emailAddress().map((e) => e.toUpperCase()),
  fc.string(),
);

describe("EmailAddress normalization (ADR-0056) — properties", () => {
  it("is idempotent: normalizing an already-normalized address changes nothing", () => {
    fc.assert(
      fc.property(messyEmail, (raw) => {
        const once = normalizeEmailAddress(raw);
        expect(normalizeEmailAddress(once)).toBe(once);
      }),
    );
  });

  it("normalizes every list member — a list entry equals its own single-value normalization", () => {
    fc.assert(
      fc.property(fc.array(messyEmail), (raws) => {
        for (const e of normalizeEmailAddresses(raws)) {
          expect(normalizeEmailAddress(e)).toBe(e);
        }
      }),
    );
  });

  it("dedupes and drops empties, never inventing or reordering an address", () => {
    fc.assert(
      fc.property(fc.array(messyEmail), (raws) => {
        const out = normalizeEmailAddresses(raws);
        // No duplicates, no empties.
        expect(new Set(out).size).toBe(out.length);
        expect(out.every((e) => e.length > 0)).toBe(true);
        // Nothing invented: every output came from some input.
        const inputs = new Set(raws.map(normalizeEmailAddress));
        expect(out.every((e) => inputs.has(e))).toBe(true);
        // Order-preserving on first occurrence.
        const expected = [...new Set(raws.map(normalizeEmailAddress))].filter((e) => e.length > 0);
        expect([...out]).toEqual(expected);
      }),
    );
  });

  it("is idempotent as a list operation: normalizing the output is a fixed point", () => {
    fc.assert(
      fc.property(fc.array(messyEmail), (raws) => {
        const once = normalizeEmailAddresses(raws);
        expect([...normalizeEmailAddresses([...once])]).toEqual([...once]);
      }),
    );
  });

  it("makeEmailAddress accepts exactly the normalized values isValidEmailFormat accepts", () => {
    fc.assert(
      fc.property(messyEmail, (raw) => {
        const r = makeEmailAddress(raw);
        expect(r.ok).toBe(isValidEmailFormat(normalizeEmailAddress(raw)));
        if (r.ok) expect(r.value).toBe(normalizeEmailAddress(raw));
      }),
    );
  });
});
