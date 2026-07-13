// Pure presentation helpers for the in-viewer editor's Comments / Versions
// panels (comment-display-polish). apps/view has NO jsdom/component test tier
// (vitest `environment: "node"`), so these helpers are extracted from the TSX
// components precisely so their logic is unit-testable without a mounted tree.
import { describe, expect, it } from "vitest";
import { authorInitials, relativeTime } from "./comment-format";

describe("authorInitials", () => {
  it("prefers the NAME: first char of each of the first two words → 'JD'", () => {
    expect(authorInitials("Jane Doe", "jane@example.com")).toBe("JD");
  });

  it("uses the first two alnum chars of a single-word name → 'JA'", () => {
    expect(authorInitials("Jane", null)).toBe("JA");
  });

  it("ignores extra words / whitespace, taking only the first two words", () => {
    expect(authorInitials("  Mary  Jane  Watson ", null)).toBe("MJ");
  });

  it("strips non-alnum chars within name words", () => {
    expect(authorInitials("Jean-Luc Picard", null)).toBe("JP");
  });

  it("falls back to the EMAIL local-part when the name is null", () => {
    expect(authorInitials(null, "jane@example.com")).toBe("JA");
  });

  it("falls back to the email when the name has no alnum chars", () => {
    expect(authorInitials("...", "bob@example.com")).toBe("BO");
  });

  it("uses the single available email char for a one-char local-part", () => {
    expect(authorInitials(null, "j@example.com")).toBe("J");
  });

  it("skips leading non-alnum chars in the email local-part", () => {
    expect(authorInitials(null, "_bob.smith@example.com")).toBe("BO");
  });

  it("returns '?' when both name and email are null", () => {
    expect(authorInitials(null, null)).toBe("?");
  });

  it("returns '?' when neither name nor email carry an alnum char", () => {
    expect(authorInitials("...", "...@example.com")).toBe("?");
  });

  it("returns '?' for empty strings", () => {
    expect(authorInitials("", "")).toBe("?");
  });
});

describe("relativeTime", () => {
  // A fixed clock so the relative math is deterministic.
  const now = Date.parse("2026-07-12T12:00:00.000Z");
  const at = (deltaMs: number) => new Date(now + deltaMs).toISOString();

  it("says 'just now' for a sub-minute delta", () => {
    expect(relativeTime(at(-30_000), now)).toBe("just now");
  });

  it("says 'just now' for exactly now", () => {
    expect(relativeTime(at(0), now)).toBe("just now");
  });

  it("renders minutes ago", () => {
    expect(relativeTime(at(-5 * 60_000), now)).toBe("5m ago");
  });

  it("renders hours ago", () => {
    expect(relativeTime(at(-2 * 60 * 60_000), now)).toBe("2h ago");
  });

  it("renders days ago", () => {
    expect(relativeTime(at(-3 * 24 * 60 * 60_000), now)).toBe("3d ago");
  });

  it("crosses the hour boundary at 60 minutes", () => {
    expect(relativeTime(at(-60 * 60_000), now)).toBe("1h ago");
  });

  it("defaults nowMs to the current clock when omitted", () => {
    // Within the same second the delta is sub-minute → 'just now'.
    expect(relativeTime(new Date().toISOString())).toBe("just now");
  });
});
