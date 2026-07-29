// The overlay-owned intent highlight palette (comment-UX adoptions, item A).
// Fixed constants — deliberately NEVER derived from the report document's own
// CSS (the report is untrusted content; the overlay owns its affordance
// colors). One entry per ADR-0064 Decision 8 intent; a drift guard against
// the domain `Intent` union lives in apps/view (where arp-domain is a
// dependency — arp-editor stays decoupled from it by design).
import { describe, expect, it } from "vitest";
import { COMMENT_INTENT_COLORS, normalizeIntent } from "./comment-colors";

describe("COMMENT_INTENT_COLORS", () => {
  it("defines exactly the four ADR-0064 intents", () => {
    expect(Object.keys(COMMENT_INTENT_COLORS).sort()).toEqual([
      "add",
      "enhancement",
      "note",
      "remove",
    ]);
  });

  it("gives every intent a distinct background and underline", () => {
    const backgrounds = Object.values(COMMENT_INTENT_COLORS).map((c) => c.background);
    const underlines = Object.values(COMMENT_INTENT_COLORS).map((c) => c.underline);
    expect(new Set(backgrounds).size).toBe(backgrounds.length);
    expect(new Set(underlines).size).toBe(underlines.length);
  });

  it("keeps `note` on the pre-existing amber highlight (visual continuity)", () => {
    expect(COMMENT_INTENT_COLORS.note.background).toBe("rgba(244, 201, 93, 0.28)");
    expect(COMMENT_INTENT_COLORS.note.underline).toBe("rgba(244, 201, 93, 0.55)");
  });
});

describe("normalizeIntent", () => {
  it("passes through each known intent", () => {
    expect(normalizeIntent("note")).toBe("note");
    expect(normalizeIntent("enhancement")).toBe("enhancement");
    expect(normalizeIntent("add")).toBe("add");
    expect(normalizeIntent("remove")).toBe("remove");
  });

  it("falls back to `note` for an unknown, missing, or non-string intent", () => {
    expect(normalizeIntent("shout")).toBe("note");
    expect(normalizeIntent(undefined)).toBe("note");
    expect(normalizeIntent("")).toBe("note");
  });
});
