// The Selection toolbar (ticket #296): a Notion-style floating bar anchored
// over the editor's text selection in the unified experience's Edit mode.
// THIS SLICE IS THE SHELL — the buttons are placeholders (no formatting
// commands yet; those are the follow-up tickets), but the placement,
// lifecycle and coordinate seam are the real, final ones.
//
// Placement is measure-then-place: the bar first renders OFFSCREEN (also the
// SSR output — effects don't run on the server), a mount effect measures the
// rendered size, and `placeToolbar` (arp-editor, pure) turns the selection
// geometry + that size into a position clamped inside the editing surface.
// `geometry` arrives in HOST viewport coordinates — ReportEditor already
// translated out of its iframe (selection-rect.ts) — so this component never
// touches the iframe at all.
//
// `onMouseDown={preventDefault}` is load-bearing: the editor's selection
// lives in the sandboxed iframe, and a default-handled mousedown on this
// (parent-document) bar would move focus out of it, visually dropping the
// very selection the bar operates on. Suppressing the default keeps focus —
// and the selection — in the editing surface, which is also what makes the
// "clicking the toolbar does not collapse the selection" browser contract
// hold.
import { placeToolbar, type SelectionGeometry } from "arp-editor";
import { Floating, MoreIcon } from "arp-ui";
import { useEffect, useRef, useState } from "react";

export interface SelectionToolbarProps {
  /** Where the selection sits on the host page (rect + surface bounds). */
  readonly geometry: SelectionGeometry;
}

/** Rendered-but-unmeasured (and SSR) position: parked far offscreen so the
 *  measuring first paint is never visible. */
const OFFSCREEN = { left: -9999, top: -9999, placement: "above" as const };

const buttonClass =
  "inline-flex h-7 min-w-7 items-center justify-center rounded-control px-1.5 text-sm text-muted hover:bg-surface hover:text-fg";

export function SelectionToolbar({ geometry }: SelectionToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  // Measure once on mount: this slice's content is static, so the size can't
  // change afterwards. Re-placement on geometry changes is plain arithmetic
  // in render.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setSize({ width, height });
  }, []);

  const placed = size
    ? placeToolbar({ selection: geometry.rect, toolbar: size, bounds: geometry.surface })
    : OFFSCREEN;

  return (
    <Floating
      ref={ref}
      left={placed.left}
      top={placed.top}
      role="toolbar"
      aria-label="Selection toolbar"
      data-testid="selection-toolbar"
      data-placement={placed.placement}
      className="flex items-center gap-0.5 p-1"
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" aria-label="Bold" className={buttonClass}>
        <span className="font-bold">B</span>
      </button>
      <button type="button" aria-label="Italic" className={buttonClass}>
        <span className="italic">I</span>
      </button>
      <button type="button" aria-label="Link" className={buttonClass}>
        <span className="underline">↗</span>
      </button>
      <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
      <button type="button" aria-label="More actions" className={buttonClass}>
        <MoreIcon className="h-4 w-4" />
      </button>
    </Floating>
  );
}
