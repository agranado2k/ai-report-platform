// Behavior tests for parseVersionQuery — the pure ?v=N query-param parser behind
// $slug.tsx's version-by-ordinal resolution (issue #155, ADR-0038 §3). No
// Request/Response needed, so it's cheap to unit test directly, mirroring
// edit-session.test.ts's carve-out for apps/view/app/server's pure helpers.
import { describe, expect, it } from "vitest";
import { parseVersionQuery } from "./version-query";

describe("parseVersionQuery", () => {
  it("returns undefined (absent → serve live) when the param is missing", () => {
    expect(parseVersionQuery(null)).toBeUndefined();
  });

  it("returns undefined (absent → serve live) for an empty string", () => {
    expect(parseVersionQuery("")).toBeUndefined();
  });

  it("parses a plain positive-integer ordinal", () => {
    expect(parseVersionQuery("1")).toBe(1);
    expect(parseVersionQuery("42")).toBe(42);
  });

  it("tolerates leading zeros", () => {
    expect(parseVersionQuery("007")).toBe(7);
  });

  // Malformed input is treated as absent (serve live) rather than 404 — the
  // route had NO ?v=N handling before this change, so there's no existing
  // precedent to preserve; "ignore an unparseable optional param and fall back
  // to the safe default" doesn't create a version-enumeration or oracle surface
  // (unlike returning 404, which would confirm "v is being read at all" in a
  // way distinguishable from a plain slug-only request). Judgment call — see
  // the #155 PR description.
  it("treats a non-numeric value as absent (serve live), not 404", () => {
    expect(parseVersionQuery("abc")).toBeUndefined();
  });

  it("treats a decimal value as absent (serve live), not 404", () => {
    expect(parseVersionQuery("1.5")).toBeUndefined();
  });

  it("treats a negative sign as absent at the parse layer (out-of-range 0/negative is a resolver-layer 404, not a parse-layer concern)", () => {
    expect(parseVersionQuery("-1")).toBeUndefined();
  });

  it("treats exponent/scientific notation as absent, not silently coerced to an integer", () => {
    expect(parseVersionQuery("1e2")).toBeUndefined();
  });

  it("treats whitespace-padded input as absent", () => {
    expect(parseVersionQuery(" 1")).toBeUndefined();
    expect(parseVersionQuery("1 ")).toBeUndefined();
  });

  it("passes 0 through as a well-formed integer (the resolver, not the parser, 404s out-of-range ordinals)", () => {
    expect(parseVersionQuery("0")).toBe(0);
  });
});
