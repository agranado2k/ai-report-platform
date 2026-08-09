// The Selection toolbar's coordinate seam (ticket #296). ProseMirror's
// `coordsAtPos` returns coords in the EDITING IFRAME's viewport space;
// anything floating over the selection renders in the HOST page's tree
// (ReportEditor.tsx mounts PM inside a sandboxed iframe). This pure module
// does the union + translation so ReportEditor can report a host-space
// `SelectionGeometry` and the DOM-owning code stays measurement-only.
import type { SelectionRect } from "./toolbar-placement";

/** The shape `EditorView#coordsAtPos` returns — one caret-ish rect per
 *  position, in the iframe's viewport coordinates. */
export interface PositionCoords {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The iframe's own `getBoundingClientRect()`, in host viewport coordinates. */
export interface FrameRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Where a selection sits on the HOST page: its bounding rect, plus the
 *  editing surface's rect in the same space — the bounds any floating UI
 *  anchored to the selection should stay within. */
export interface SelectionGeometry {
  readonly rect: SelectionRect;
  readonly surface: SelectionRect;
}

/** Whether a selection report should carry geometry at all: only for a live
 *  selection, and never mid-drag — a bar appearing under a moving pointer
 *  would flicker and swallow the drag's own mouse events (the drag's
 *  geometry comes from the mouseup re-report instead). Pure, because the
 *  browser tier cannot drive a held-button drag (see
 *  tests/browser/selection-toolbar.spec.ts's file comment) — this decision
 *  is only testable here, at the node tier. */
export function shouldComputeGeometry(
  selection: { readonly from: number; readonly to: number } | null,
  midDrag: boolean,
): boolean {
  return selection !== null && !midDrag;
}

export function selectionGeometry(
  start: PositionCoords,
  end: PositionCoords,
  frame: FrameRect,
): SelectionGeometry {
  return {
    rect: {
      left: Math.min(start.left, end.left) + frame.left,
      top: Math.min(start.top, end.top) + frame.top,
      right: Math.max(start.right, end.right) + frame.left,
      bottom: Math.max(start.bottom, end.bottom) + frame.top,
    },
    surface: {
      left: frame.left,
      top: frame.top,
      right: frame.left + frame.width,
      bottom: frame.top + frame.height,
    },
  };
}
