// The Selection toolbar's placement rule (ticket #296): prefer floating ABOVE
// the selection, flip BELOW when there is no room above inside the editing
// surface's bounds, and never leave the bounds horizontally. Pure geometry —
// the browser tier proves the same behavior over a real mounted editor; this
// suite pins the decision table.
import { describe, expect, it } from "vitest";
import {
  placeToolbar,
  TOOLBAR_GAP_PX,
  TOOLBAR_MARGIN_PX,
  type ToolbarPlacementInput,
} from "./toolbar-placement";

/** The /edit layout's document pane, in host viewport coordinates: a 53px
 *  topbar above it, a side panel to its right. Matches the browser harness's
 *  hand-copied geometry (tests/browser/harness/build.mts). */
const BOUNDS = { left: 0, top: 53, right: 680, bottom: 700 } as const;
const TOOLBAR = { width: 200, height: 36 } as const;

function input(selection: ToolbarPlacementInput["selection"]): ToolbarPlacementInput {
  return { selection, toolbar: TOOLBAR, bounds: BOUNDS };
}

describe("placeToolbar", () => {
  it("floats above the selection, horizontally centered, with the gap", () => {
    const placed = placeToolbar(input({ left: 100, top: 300, right: 200, bottom: 320 }));
    expect(placed).toEqual({
      placement: "above",
      top: 300 - TOOLBAR_GAP_PX - TOOLBAR.height,
      left: 150 - TOOLBAR.width / 2,
    });
  });

  it("flips below when the toolbar would poke out of the surface's top", () => {
    const placed = placeToolbar(input({ left: 100, top: 60, right: 200, bottom: 80 }));
    expect(placed.placement).toBe("below");
    expect(placed.top).toBe(80 + TOOLBAR_GAP_PX);
  });

  it("clamps to the surface's left edge for a selection near it", () => {
    const placed = placeToolbar(input({ left: 0, top: 300, right: 20, bottom: 320 }));
    expect(placed.left).toBe(BOUNDS.left + TOOLBAR_MARGIN_PX);
  });

  it("clamps to the surface's right edge for a selection near it", () => {
    const placed = placeToolbar(input({ left: 640, top: 300, right: 680, bottom: 320 }));
    expect(placed.left).toBe(BOUNDS.right - TOOLBAR_MARGIN_PX - TOOLBAR.width);
  });

  it("keeps a flipped toolbar inside the surface when below overflows too", () => {
    // A selection spanning nearly the whole surface: no room above OR below.
    const placed = placeToolbar(input({ left: 100, top: 60, right: 200, bottom: 690 }));
    expect(placed.placement).toBe("below");
    expect(placed.top).toBe(BOUNDS.bottom - TOOLBAR_MARGIN_PX - TOOLBAR.height);
  });

  // The one case stated in LITERAL numbers (claude-review #301 M-6): every
  // other expectation is computed from TOOLBAR_GAP_PX / TOOLBAR_MARGIN_PX,
  // so a silent change to the constants themselves would survive the whole
  // relational suite. This is the constants' witness — if it fails and the
  // relational cases pass, someone changed the gap or margin.
  it("witnesses the constants: gap and margin are 8px", () => {
    expect(TOOLBAR_GAP_PX).toBe(8);
    expect(TOOLBAR_MARGIN_PX).toBe(8);
    expect(placeToolbar(input({ left: 100, top: 300, right: 200, bottom: 320 }))).toEqual({
      placement: "above",
      top: 256,
      left: 50,
    });
  });

  it("pins to the surface's top edge — never over the chrome above it — when the surface is shorter than the toolbar", () => {
    const placed = placeToolbar({
      selection: { left: 100, top: 60, right: 200, bottom: 70 },
      toolbar: TOOLBAR,
      bounds: { left: 0, top: 53, right: 680, bottom: 80 },
    });
    expect(placed.top).toBe(53 + TOOLBAR_MARGIN_PX);
  });
});
