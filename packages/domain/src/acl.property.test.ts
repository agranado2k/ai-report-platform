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

/** Arbitrary boundary input: every mode crossed with every optional field, so the
 *  mode/field combinations nobody writes a test for (a password hash on an `org`
 *  Acl, an allowlist on a `public` one) are covered too. */
const anyAclInput: fc.Arbitrary<MakeAclInput> = fc.record<MakeAclInput>(
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
