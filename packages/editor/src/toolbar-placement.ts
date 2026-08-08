// Where the Selection toolbar floats relative to a text selection (ticket
// #296). Pure geometry, DOM-free: the caller measures the toolbar and the
// editing surface and passes rects; this module only decides. The coordinate
// space is whatever the caller's rects share — in the app, the host page's
// viewport (see selection-rect.ts for how the iframe-space selection gets
// there).

/** An axis-aligned rectangle in the caller's coordinate space. */
export interface SelectionRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Vertical breathing room between the selection and the toolbar. */
export const TOOLBAR_GAP_PX = 8;
/** Minimum distance kept between the toolbar and the surface's edges. */
export const TOOLBAR_MARGIN_PX = 8;

export interface ToolbarPlacementInput {
  /** The selection's bounding rect. */
  readonly selection: SelectionRect;
  /** The toolbar's own measured size. */
  readonly toolbar: { readonly width: number; readonly height: number };
  /** The editing surface's rect — the region the toolbar must stay inside
   *  (so it never covers the app chrome around the document pane). */
  readonly bounds: SelectionRect;
}

export interface ToolbarPosition {
  readonly left: number;
  readonly top: number;
  readonly placement: "above" | "below";
}

/** Prefer floating ABOVE the selection; flip BELOW when the toolbar would
 *  poke out of the surface's top; clamp inside the surface on every edge. */
export function placeToolbar({
  selection,
  toolbar,
  bounds,
}: ToolbarPlacementInput): ToolbarPosition {
  const aboveTop = selection.top - TOOLBAR_GAP_PX - toolbar.height;
  const fitsAbove = aboveTop >= bounds.top + TOOLBAR_MARGIN_PX;
  const placement = fitsAbove ? "above" : "below";
  const rawTop = fitsAbove ? aboveTop : selection.bottom + TOOLBAR_GAP_PX;
  const top = clamp(
    rawTop,
    bounds.top + TOOLBAR_MARGIN_PX,
    bounds.bottom - TOOLBAR_MARGIN_PX - toolbar.height,
  );

  const center = (selection.left + selection.right) / 2;
  const left = clamp(
    center - toolbar.width / 2,
    bounds.left + TOOLBAR_MARGIN_PX,
    bounds.right - TOOLBAR_MARGIN_PX - toolbar.width,
  );

  return { left, top, placement };
}

/** Ordinary clamp, except a DEGENERATE range (`max < min` — a surface
 *  smaller than the toolbar itself) pins to `min`: the top/left edge is
 *  where the app chrome (TopBar, panel) sits, and overflowing AWAY from it
 *  beats painting the z-raised bar over it. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(max, min));
}
