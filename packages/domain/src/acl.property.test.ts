// Property-based tests for the Acl Value Object (ADR-0056, ADR-0081).
//
// The invariants here are the ones the viewer's authorization path leans on, so
// they should hold for EVERY input the boundary can hand `makeAcl`, not just the
// six examples in acl.test.ts. Two of them are safety properties in the strict
// sense — "no input produces an Acl that serves more widely than asked for".
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCESS_TTL_SECONDS,
  isPrivateAcl,
  MAX_ACCESS_TTL_SECONDS,
  type MakeAclInput,
  MIN_ACCESS_TTL_SECONDS,
  makeAcl,
} from "./acl";
import { normalizeEmailAddresses } from "./email-address";
import type { AclMode } from "./value-objects";

const aclMode = fc.constantFrom<AclMode>("private", "public", "org", "password", "allowlist");

/** Every mode crossed with every optional field, so the mode/field combinations
 *  nobody writes a test for (a password hash on an `org` Acl, an allowlist on a
 *  `public` one) are covered. Left in the mix below as the chaos arm. */
const chaoticAclInput: fc.Arbitrary<MakeAclInput> = fc.record<MakeAclInput>(
  {
    mode: aclMode,
    passwordHash: fc.option(fc.string(), { nil: undefined }),
    allowedEmails: fc.option(fc.array(fc.oneof(fc.emailAddress(), fc.string())), {
      nil: undefined,
    }),
    accessTtlSeconds: fc.option(fc.integer({ min: -10, max: MAX_ACCESS_TTL_SECONDS + 10 }), {
      nil: undefined,
    }),
  },
  { requiredKeys: ["mode"] },
);

/**
 * Boundary input, weighted so every mode is drawn often — most importantly the
 * ACCEPTED `allowlist` Acl, the only shape that carries the ADR-0056 TTL and
 * normalized-email invariants.
 *
 * `chaoticAclInput` alone reached an accepted `allowlist` in ~1.4% of draws
 * (measured over 10k): `mode` is `allowlist` a fifth of the time, but the
 * allowlist then has to survive present-and-non-empty, every entry a valid
 * format, and an in-range TTL — and its entries are half arbitrary strings. So
 * the four allowlist properties below spent almost every run returning early,
 * asserting nothing. Weighting is not cosmetic here: an arbitrary that reaches
 * the interesting branch by luck is a test that passes by luck.
 */
const anyAclInput: fc.Arbitrary<MakeAclInput> = fc.oneof(
  // Modes that construct unconditionally.
  {
    arbitrary: fc.record<MakeAclInput>({
      mode: fc.constantFrom<AclMode>("private", "public", "org"),
    }),
    weight: 2,
  },
  // `password`, both sides of the non-blank check.
  {
    arbitrary: fc.record<MakeAclInput>({
      mode: fc.constant<AclMode>("password"),
      passwordHash: fc.oneof(fc.string({ minLength: 1 }), fc.constantFrom("", "   ")),
    }),
    weight: 2,
  },
  // `allowlist` that should be ACCEPTED: ≥1 real address, in-range or absent TTL.
  {
    arbitrary: fc.record<MakeAclInput>(
      {
        mode: fc.constant<AclMode>("allowlist"),
        allowedEmails: fc.array(fc.emailAddress(), { minLength: 1, maxLength: 6 }),
        accessTtlSeconds: fc.option(
          fc.integer({ min: MIN_ACCESS_TTL_SECONDS, max: MAX_ACCESS_TTL_SECONDS }),
          { nil: undefined },
        ),
      },
      { requiredKeys: ["mode", "allowedEmails"] },
    ),
    weight: 4,
  },
  // `allowlist` straddling each rejection edge: empty list, junk entries,
  // out-of-range and non-integer TTLs.
  {
    arbitrary: fc.record<MakeAclInput>(
      {
        mode: fc.constant<AclMode>("allowlist"),
        allowedEmails: fc.option(fc.array(fc.oneof(fc.emailAddress(), fc.string())), {
          nil: undefined,
        }),
        accessTtlSeconds: fc.option(
          fc.oneof(
            fc.integer({ min: MIN_ACCESS_TTL_SECONDS - 5, max: MIN_ACCESS_TTL_SECONDS + 5 }),
            fc.integer({ min: MAX_ACCESS_TTL_SECONDS - 5, max: MAX_ACCESS_TTL_SECONDS + 5 }),
            fc.double({ noNaN: true, min: -10, max: 10 }),
          ),
          { nil: undefined },
        ),
      },
      { requiredKeys: ["mode"] },
    ),
    weight: 3,
  },
  // The original unrestricted cross-product, kept for the odd mode/field pairs.
  { arbitrary: chaoticAclInput, weight: 3 },
);

describe("Acl construction (ADR-0056) — properties", () => {
  it("only `public` is non-private: every constructible Acl needs authorization unless it is public", () => {
    fc.assert(
      fc.property(anyAclInput, (input) => {
        const r = makeAcl(input);
        if (r.ok) expect(isPrivateAcl(r.value)).toBe(r.value.mode !== "public");
      }),
    );
  });

  it("never widens the mode: a constructed Acl carries exactly the mode that was asked for", () => {
    fc.assert(
      fc.property(anyAclInput, (input) => {
        const r = makeAcl(input);
        if (r.ok) expect(r.value.mode).toBe(input.mode);
      }),
    );
  });

  it("carries no password hash outside `password` mode — no mode leaks a secret it does not use", () => {
    fc.assert(
      fc.property(anyAclInput, (input) => {
        const r = makeAcl(input);
        if (r.ok && r.value.mode !== "password") {
          expect(Object.hasOwn(r.value, "passwordHash")).toBe(false);
        }
      }),
    );
  });

  it("an accepted allowlist Acl always has an in-range Access TTL and ≥1 normalized email", () => {
    fc.assert(
      fc.property(anyAclInput, (input) => {
        const r = makeAcl(input);
        if (!r.ok || r.value.mode !== "allowlist") return;
        expect(r.value.accessTtlSeconds).toBeGreaterThanOrEqual(MIN_ACCESS_TTL_SECONDS);
        expect(r.value.accessTtlSeconds).toBeLessThanOrEqual(MAX_ACCESS_TTL_SECONDS);
        expect(Number.isInteger(r.value.accessTtlSeconds)).toBe(true);
        expect(r.value.allowedEmails.length).toBeGreaterThan(0);
        // Oracle note: `normalizeEmailAddresses` is deliberately the oracle here —
        // the claim under test is "`makeAcl` routes the allowlist through the ONE
        // normalization home (ADR-0056)", not "normalization is correct". That is
        // pinned independently in email-address.property.test.ts.
        expect([...r.value.allowedEmails]).toEqual([
          ...normalizeEmailAddresses(input.allowedEmails ?? []),
        ]);
      }),
    );
  });

  it("the allowlist Access TTL is accepted for exactly the in-range integers", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_ACCESS_TTL_SECONDS - 5, max: MAX_ACCESS_TTL_SECONDS + 5 }),
        (ttl) => {
          const r = makeAcl({
            mode: "allowlist",
            allowedEmails: ["owner@example.com"],
            accessTtlSeconds: ttl,
          });
          const inRange = ttl >= MIN_ACCESS_TTL_SECONDS && ttl <= MAX_ACCESS_TTL_SECONDS;
          expect(r.ok).toBe(inRange);
        },
      ),
    );
  });

  it("omitting the Access TTL always yields the 7-day default", () => {
    fc.assert(
      fc.property(fc.array(fc.emailAddress(), { minLength: 1 }), (emails) => {
        const r = makeAcl({ mode: "allowlist", allowedEmails: emails });
        if (r.ok && r.value.mode === "allowlist") {
          expect(r.value.accessTtlSeconds).toBe(DEFAULT_ACCESS_TTL_SECONDS);
        }
      }),
    );
  });
});
