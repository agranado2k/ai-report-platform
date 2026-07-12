// Pure presentation helpers for the in-viewer editor's Comments / Versions
// panels (comment-display-polish). apps/view has NO jsdom/component test tier
// (vitest `environment: "node"`), so these helpers are extracted from the TSX
// components precisely so their logic is unit-testable without a mounted tree.
import { describe, expect, it } from "vitest";
import { initialsFromEmail, relativeTime } from "./comment-format";

describe("initialsFromEmail", () => {
  it("derives up-to-two uppercased alnum initials from the local-part", () => {
    expect(initialsFromEmail("jane@example.com")).toBe("JA");
  });

  it("uses the single available char for a one-char local-part", () => {
    expect(initialsFromEmail("j@example.com")).toBe("J");
  });

  it("skips leading non-alnum chars in the local-part", () => {
    expect(initialsFromEmail("_bob.smith@example.com")).toBe("BO");
  });

  it("returns '?' when the email is null", () => {
    expect(initialsFromEmail(null)).toBe("?");
  });

  it("returns '?' when the local-part has no alnum chars", () => {
    expect(initialsFromEmail("...@example.com")).toBe("?");
  });

  it("returns '?' for an empty string", () => {
    expect(initialsFromEmail("")).toBe("?");
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
