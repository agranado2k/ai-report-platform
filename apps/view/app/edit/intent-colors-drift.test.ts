// Drift guard for the overlay-owned intent highlight palette (comment-UX
// adoptions, item A). arp-editor deliberately does NOT depend on arp-domain
// (its comment types are structural, matching the anchor's opaque `relative`
// design), so the palette's key set can't be checked against the domain
// `Intent` union at its definition site. This app CAN: `Intent` is a
// TYPE-ONLY import (erased at build — a VALUE import from the arp-domain
// barrel would drag `node:crypto` into the browser bundle, same rationale as
// CommentsPanel.tsx), so the two compile-time assignments below break the
// BUILD (typecheck) if the domain enum gains/loses a member without the
// palette following — the same drift-safety CommentsPanel's
// `Record<Intent, string>` label map already has.
import type { Intent } from "arp-domain";
import { COMMENT_INTENT_COLORS, normalizeIntent } from "arp-editor";
import { describe, expect, it } from "vitest";

// Every domain Intent has a palette entry (fails typecheck on a MISSING key).
const paletteCoversEveryIntent: Record<Intent, unknown> = COMMENT_INTENT_COLORS;
// Every palette key IS a domain Intent (fails typecheck on an EXTRA key).
const everyPaletteKeyIsAnIntent: readonly Intent[] = Object.keys(
  COMMENT_INTENT_COLORS,
) as (keyof typeof COMMENT_INTENT_COLORS)[];

describe("intent highlight palette ↔ domain Intent drift guard", () => {
  it("keeps the palette keyed by exactly the domain intents", () => {
    // The real assertions are the two compile-time assignments above; this
    // runtime check just keeps vitest from flagging them as unused fixtures.
    expect(Object.keys(paletteCoversEveryIntent).sort()).toEqual(
      [...everyPaletteKeyIsAnIntent].sort(),
    );
  });

  it("normalizes any wire string to a paintable intent", () => {
    const normalized: Intent = normalizeIntent("not-a-real-intent");
    expect(normalized).toBe("note");
  });
});
