// Property-based tests for the External Id codec (ADR-0052, ADR-0081).
//
// The example-based tests next door pin a handful of concrete ids. These pin the
// LAW: what `encodeExternalId`/`decodeExternalId` promise for EVERY uuid, not the
// three someone thought to type out. fast-check generates the inputs (100 cases
// per property by default) and shrinks any counterexample to a minimal one.
//
// No fixed seed: fast-check's default is a random seed per run, and a flaky
// property here would mean a REAL edge case the codec doesn't handle — we want to
// hear about it, not pin it away. A failure prints the seed + path so the exact
// case is replayable (`fc.assert(..., { seed, path })`).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeExternalId, encodeExternalId } from "./external-id";

/** Any canonical hyphenated uuid — the codec is a codec over 128 bits, not over
 *  RFC-4122 versions, so this deliberately covers the whole space including the
 *  all-zeros and leading-zero ids the fixed-width padding exists for. */
const anyUuid = fc
  .stringMatching(/^[0-9a-f]{32}$/)
  .map(
    (hex) =>
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  );

const anyPrefix = fc.constantFrom("report", "folder", "user", "version", "comment");

describe("External Id codec (ADR-0052) — properties", () => {
  it("round-trips every uuid: decode(encode(uuid)) is the same uuid", () => {
    fc.assert(
      fc.property(anyPrefix, anyUuid, (prefix, uuid) => {
        const decoded = decodeExternalId(prefix, encodeExternalId(prefix, uuid), "id");
        expect(decoded.ok).toBe(true);
        if (decoded.ok) expect(decoded.value).toBe(uuid);
      }),
    );
  });

  it("encodes to a fixed 22-char base62 body — no uuid encodes shorter or longer", () => {
    fc.assert(
      fc.property(anyPrefix, anyUuid, (prefix, uuid) => {
        const wire = encodeExternalId(prefix, uuid);
        expect(wire.startsWith(`${prefix}_`)).toBe(true);
        expect(wire.slice(prefix.length + 1)).toMatch(/^[0-9A-Za-z]{22}$/);
      }),
    );
  });

  it("is prefix-bound: an External Id never decodes under a different prefix", () => {
    fc.assert(
      fc.property(anyPrefix, anyPrefix, anyUuid, (minted, expected, uuid) => {
        fc.pre(minted !== expected);
        const wire = encodeExternalId(minted, uuid);
        const decoded = decodeExternalId(expected, wire, "id");
        expect(decoded.ok).toBe(false);
      }),
    );
  });

  it("is injective: two different uuids never share an External Id", () => {
    fc.assert(
      fc.property(anyUuid, anyUuid, (a, b) => {
        fc.pre(a !== b);
        expect(encodeExternalId("report", a)).not.toBe(encodeExternalId("report", b));
      }),
    );
  });
});
