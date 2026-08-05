// The one definition of "this pointer gesture was a click, not a drag",
// shared by every editor feature that reacts to a click (comment-highlight
// focus, link activation). Extracted from comment-decorations.ts so link and
// comment activation can never disagree about what a click IS — two copies
// of a slop threshold is exactly the kind of drift that produces "the link
// opened while I was selecting its text".

/** A viewport point captured from a pointer event (`clientX`/`clientY`). */
export interface ClickPoint {
  readonly x: number;
  readonly y: number;
}

/** How far (px, per axis) the pointer may drift between mousedown and click
 *  before we treat the gesture as a drag, not a click — mirrors
 *  prosemirror-view's own `updateAllowDefault` threshold. */
export const CLICK_SLOP_PX = 4;

/**
 * Whether a tracked `mousedown` → `click` pair is a click rather than a drag.
 *
 * `false` when there is no tracked mousedown at all: a click event without
 * one means the gesture started outside the editor (or the tracker was lost),
 * and we will not act on a gesture we did not see the start of.
 *
 * This deliberately does NOT use ProseMirror's `handleClick` prop. PM's
 * internal `MouseDown` tracker is destroyed by Chrome's synthesized
 * `mousemove` (`buttons === 0`, same coordinates) delivered between mousedown
 * and mouseup inside the editor's sandboxed iframe, so `handleClick` never
 * fires there (2026-07-29 dogfood E3). The native `click` DOM event survives
 * that quirk, and this function supplies the drag discrimination PM would
 * otherwise have done.
 */
export function isClickNotDrag(down: ClickPoint | null | undefined, up: ClickPoint): boolean {
  if (!down) return false;
  return Math.abs(up.x - down.x) <= CLICK_SLOP_PX && Math.abs(up.y - down.y) <= CLICK_SLOP_PX;
}
