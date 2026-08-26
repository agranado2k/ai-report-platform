// The Selection toolbar (tickets #296/#297): a Notion-style floating bar
// anchored over the editor's text selection in the unified experience's Edit
// mode. The Bold and Italic buttons are live (ticket #297): `formats` is the
// editor's own active-state reading (arp-editor's `activeFormats`, riding
// every selection report), `onToggleFormat` dispatches the toggle back
// through the editor's handle, and `aria-pressed` mirrors the active state.
// The Link and More buttons remain placeholders for #299/#300.
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
import {
  type ActiveFormats,
  placeToolbar,
  type SelectionGeometry,
  type ToggleableFormat,
  type ToolbarPlacementInput,
  type ToolbarPosition,
} from "arp-editor";
import { Floating, MoreIcon } from "arp-ui";
import { useEffect, useRef, useState } from "react";

export interface SelectionToolbarProps {
  /** Where the selection sits on the host page (rect + surface bounds). */
  readonly geometry: SelectionGeometry;
  /** Which formats the selection carries — the editor's own reading
   *  (`activeFormats`), reported alongside the geometry. Drives the toggle
   *  buttons' pressed state. */
  readonly formats: ActiveFormats;
  /** Dispatch a mark toggle back to the editor (ReportEditorHandle
   *  .toggleFormat). The toolbar never touches the editor directly — the
   *  host owns the ref, this component only asks. */
  readonly onToggleFormat: (format: ToggleableFormat) => void;
}

/** Rendered-but-unmeasured (and SSR) position: parked far offscreen so the
 *  measuring first paint is never visible. */
const OFFSCREEN: ToolbarPosition = { left: -9999, top: -9999, placement: "above" };

// Not arp-ui's `Button`: the bar sits on `bg-surface-raised`, so ghost's
// `hover:bg-surface-raised` would be an invisible hover — this inverts to
// `hover:bg-surface` — and these are square icon slots, not text buttons.
// The focus-visible ring matches Button's exactly (claude-review #301 H-7):
// a `role="toolbar"` full of buttons with no visible keyboard focus would be
// the only such buttons in the product.
//
// Active (pressed) styling reuses the hover treatment as a STEADY state —
// same box metrics either way, so the mount-time size measurement stays
// valid. The idle/active split exists because `text-muted` and `text-fg`
// would otherwise compete in one class list, where stylesheet order (not
// class order) decides — a silent coin flip.
const buttonBase =
  "inline-flex h-7 min-w-7 items-center justify-center rounded-control px-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";
const buttonClass = `${buttonBase} text-muted hover:bg-surface hover:text-fg`;
const activeButtonClass = `${buttonBase} bg-surface text-fg`;

export function SelectionToolbar({ geometry, formats, onToggleFormat }: SelectionToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ToolbarPlacementInput["toolbar"] | null>(null);

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
      <button
        type="button"
        aria-label="Bold"
        aria-pressed={formats.strong}
        className={formats.strong ? activeButtonClass : buttonClass}
        onClick={() => onToggleFormat("strong")}
      >
        <span className="font-bold">B</span>
      </button>
      <button
        type="button"
        aria-label="Italic"
        aria-pressed={formats.em}
        className={formats.em ? activeButtonClass : buttonClass}
        onClick={() => onToggleFormat("em")}
      >
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
