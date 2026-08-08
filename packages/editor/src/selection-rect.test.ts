// The Selection toolbar's coordinate seam (ticket #296): ProseMirror's
// `coordsAtPos` speaks in the EDITING IFRAME's viewport coordinates, while
// the toolbar renders in the HOST page — this pure module unions the
// selection's start/end coords and translates both the selection rect and the
// surface rect into the host's space, given the iframe's bounding rect.
import { describe, expect, it } from "vitest";
import { selectionGeometry } from "./selection-rect";

/** The iframe's `getBoundingClientRect()` as the /edit layout produces it:
 *  below a 53px topbar, flush left. */
const FRAME = { left: 0, top: 53, width: 680, height: 647 } as const;

describe("selectionGeometry", () => {
  it("translates a single-line selection into host coordinates", () => {
    const geometry = selectionGeometry(
      { left: 100, right: 104, top: 200, bottom: 218 },
      { left: 260, right: 264, top: 200, bottom: 218 },
      FRAME,
    );
    expect(geometry.rect).toEqual({ left: 100, top: 253, right: 264, bottom: 271 });
  });

  it("unions a multi-line selection (end left of start) into one rect", () => {
    // Drag from mid-line down to an earlier column on a later line.
    const geometry = selectionGeometry(
      { left: 300, right: 304, top: 200, bottom: 218 },
      { left: 40, right: 44, top: 240, bottom: 258 },
      FRAME,
    );
    expect(geometry.rect).toEqual({ left: 40, top: 253, right: 304, bottom: 311 });
  });

  it("reports the editing surface's own rect in the same coordinate space", () => {
    const geometry = selectionGeometry(
      { left: 100, right: 104, top: 200, bottom: 218 },
      { left: 260, right: 264, top: 200, bottom: 218 },
      FRAME,
    );
    expect(geometry.surface).toEqual({ left: 0, top: 53, right: 680, bottom: 700 });
  });
});
