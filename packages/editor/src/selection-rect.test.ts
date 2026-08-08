// The Selection toolbar's coordinate seam (ticket #296): ProseMirror's
// `coordsAtPos` speaks in the EDITING IFRAME's viewport coordinates, while
// the toolbar renders in the HOST page — this pure module unions the
// selection's start/end coords and translates both the selection rect and the
// surface rect into the host's space, given the iframe's bounding rect. Also
// home of `shouldComputeGeometry`, the mid-drag withholding gate — pure
// because the browser tier cannot drive a held-button drag, so the node tier
// is the only place this decision is testable.
import { describe, expect, it } from "vitest";
import { selectionGeometry, shouldComputeGeometry } from "./selection-rect";

/** The iframe's `getBoundingClientRect()` as an /edit-like layout produces
 *  it: below a 53px topbar — and deliberately NOT flush left (`left: 40`):
 *  with a zero left offset the horizontal translation is invisible to every
 *  assertion, and dropping `+ frame.left` from the implementation survived
 *  the suite (claude-review #301 H-6). The harness iframe sits at x=0 too,
 *  so this fixture is the only place that can see it. */
const FRAME = { left: 40, top: 53, width: 680, height: 647 } as const;

describe("selectionGeometry", () => {
  it("translates a single-line selection into host coordinates on BOTH axes", () => {
    const geometry = selectionGeometry(
      { left: 100, right: 104, top: 200, bottom: 218 },
      { left: 260, right: 264, top: 200, bottom: 218 },
      FRAME,
    );
    expect(geometry.rect).toEqual({ left: 140, top: 253, right: 304, bottom: 271 });
  });

  it("unions a multi-line selection (end left of start) into one rect", () => {
    // Drag from mid-line down to an earlier column on a later line.
    const geometry = selectionGeometry(
      { left: 300, right: 304, top: 200, bottom: 218 },
      { left: 60, right: 64, top: 240, bottom: 258 },
      FRAME,
    );
    expect(geometry.rect).toEqual({ left: 100, top: 253, right: 344, bottom: 311 });
  });

  it("reports the editing surface's own rect in the same coordinate space", () => {
    const geometry = selectionGeometry(
      { left: 100, right: 104, top: 200, bottom: 218 },
      { left: 260, right: 264, top: 200, bottom: 218 },
      FRAME,
    );
    expect(geometry.surface).toEqual({ left: 40, top: 53, right: 720, bottom: 700 });
  });
});

describe("shouldComputeGeometry", () => {
  const selection = { from: 1, to: 6 };

  it("computes geometry for a live selection outside a drag", () => {
    expect(shouldComputeGeometry(selection, false)).toBe(true);
  });

  it("withholds geometry mid-drag — the bar must not appear under a moving pointer", () => {
    expect(shouldComputeGeometry(selection, true)).toBe(false);
  });

  it("never computes geometry without a selection", () => {
    expect(shouldComputeGeometry(null, false)).toBe(false);
    expect(shouldComputeGeometry(null, true)).toBe(false);
  });
});
