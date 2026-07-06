import { describe, expect, it } from "vitest";
import { secretMatches } from "./secret";

describe("secretMatches (constant-time bearer-secret compare)", () => {
  it("returns true for identical secrets", () => {
    expect(secretMatches("abc123", "abc123")).toBe(true);
  });

  it("returns false for a different secret of the same length", () => {
    expect(secretMatches("abc123", "abc124")).toBe(false);
  });

  it("returns false (not a throw) for secrets of different lengths", () => {
    expect(secretMatches("short", "a-much-longer-secret")).toBe(false);
  });

  it("returns false for an empty provided secret against a non-empty expected one", () => {
    expect(secretMatches("", "expected")).toBe(false);
  });

  it("returns true for two empty secrets", () => {
    expect(secretMatches("", "")).toBe(true);
  });
});
