// The shared click-vs-drag gesture rule (ADR-0062 Amendment 3). Extracted
// from comment-decorations.ts so link activation and comment focus can never
// drift apart on what counts as a click.
import { describe, expect, it } from "vitest";
import { CLICK_SLOP_PX, isClickNotDrag } from "./click-gesture";

describe("isClickNotDrag", () => {
  const down = { x: 100, y: 100 };

  it("treats an unmoved pointer as a click", () => {
    expect(isClickNotDrag(down, { x: 100, y: 100 })).toBe(true);
  });

  it("allows drift up to and including the slop, on either axis", () => {
    expect(isClickNotDrag(down, { x: 100 + CLICK_SLOP_PX, y: 100 })).toBe(true);
    expect(isClickNotDrag(down, { x: 100, y: 100 + CLICK_SLOP_PX })).toBe(true);
    expect(isClickNotDrag(down, { x: 100 - CLICK_SLOP_PX, y: 100 - CLICK_SLOP_PX })).toBe(true);
  });

  it("treats drift beyond the slop as a drag, on either axis", () => {
    expect(isClickNotDrag(down, { x: 100 + CLICK_SLOP_PX + 1, y: 100 })).toBe(false);
    expect(isClickNotDrag(down, { x: 100, y: 100 + CLICK_SLOP_PX + 1 })).toBe(false);
  });

  it("is false when no mousedown was tracked — never act on a gesture we did not see start", () => {
    expect(isClickNotDrag(null, { x: 100, y: 100 })).toBe(false);
    expect(isClickNotDrag(undefined, { x: 100, y: 100 })).toBe(false);
  });
});
