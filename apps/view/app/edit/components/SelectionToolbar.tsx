// The Selection toolbar (tickets #296/#297/#299/#300): a Notion-style
// floating bar anchored over the editor's text selection in the unified
// experience's Edit mode. The Bold and Italic buttons are live (ticket #297):
// `formats` is the editor's own active-state reading (arp-editor's
// `activeFormats`, riding every selection report), `onToggleFormat`
// dispatches the toggle back through the editor's handle, and `aria-pressed`
// mirrors the active state.
// The Link button is live too (ticket #299): clicking it swaps the button row
// for a small URL editor (input + Apply / Remove-when-linked / Cancel);
// submitting validates through `validateLinkHref` — arp-editor's re-export of
// the SAME dangerous-URL rule the schema's `withSafeHref` enforces, never a
// second URL policy — and only a valid href is dispatched (`onApplyLink`).
// An invalid one gets inline feedback (aria-invalid + message) with the
// document untouched.
// The block actions are live too (ticket #300): H1–H3 convert the selection's
// blocks (pressing the ACTIVE level returns them to paragraphs) and the two
// list buttons wrap/lift (semantics pinned in arp-editor's formatting.test.ts)
// — `aria-pressed` mirrors `headingLevel`/`listKind`, which distinguish
// levels and kinds. The schema itself retains <h1>–<h6>; the bar exposes 1–3
// only (arp-editor's `HeadingLevel` — the PRD scopes "heading levels", and
// the toolbar convention is a small set). Adding these buttons changes the
// bar's RESTING width, which the mount-time measurement covers; they add no
// open/closed sub-state, so the re-measure stays keyed on the link editor
// alone. The "…" bubble is live too (ticket #298): it asks the HOST to swap
// this bar for the Floating composer at the same geometry (`onCompose`) —
// the composing state lives with the host, which owns the selection and the
// composer's post action; the bar only reports the click.
//
// Placement is measure-then-place: the bar first renders OFFSCREEN (also the
// SSR output — effects don't run on the server), a layout effect measures the
// rendered size, and `placeToolbar` (arp-editor, pure) turns the selection
// geometry + that size into a position clamped inside the editing surface.
// `geometry` arrives in HOST viewport coordinates — ReportEditor already
// translated out of its iframe (selection-rect.ts) — so this component never
// touches the iframe at all. The link editor is the bar's FIRST dynamic
// content — opening/closing it (and its error line) changes the bar's size —
// so the measurement re-runs keyed on that state. #298's composer ended up a
// SEPARATE component the host swaps in (FloatingComposer.tsx) rather than
// more swap-in content here, and it carries the general (ResizeObserver)
// re-measure its fluid size needs; this bar's enumerable sub-states keep the
// cheaper keyed effect.
//
// `onMouseDown={preventDefault}` on the container is load-bearing: the
// editor's selection lives in the sandboxed iframe, and a default-handled
// mousedown on this (parent-document) bar would move focus out of it,
// visually dropping the very selection the bar operates on. The URL input is
// the one deliberate EXCEPTION — a text input must take focus to accept
// typing, so its own mousedown stops propagating before the container's
// preventDefault. That focus shift blurs the iframe and hides the VISUAL
// selection; ProseMirror's STATE selection persists regardless, and
// `applyLink` (ReportEditorHandle) dispatches against it, so Apply still
// links exactly the range the user selected (and refocuses the editor, which
// re-reveals it).
import {
  type ActiveFormats,
  type HeadingLevel,
  type ListKind,
  placeToolbar,
  type SelectionGeometry,
  type ToggleableFormat,
  type ToolbarPlacementInput,
  type ToolbarPosition,
  validateLinkHref,
} from "arp-editor";
import { Floating, MoreIcon } from "arp-ui";
import { useEffect, useRef, useState } from "react";

export interface SelectionToolbarProps {
  /** Where the selection sits on the host page (rect + surface bounds). */
  readonly geometry: SelectionGeometry;
  /** Which formats the selection carries — the editor's own reading
   *  (`activeFormats`), reported alongside the geometry. Drives the toggle
   *  buttons' pressed state, the Link button's active state, and the link
   *  editor's pre-fill (`linkHref`). */
  readonly formats: ActiveFormats;
  /** Dispatch a mark toggle back to the editor (ReportEditorHandle
   *  .toggleFormat). The toolbar never touches the editor directly — the
   *  host owns the ref, this component only asks.
   *
   *  The three toggle props are `void` ON PURPOSE, even though the handle
   *  methods behind them return a refusal boolean: a refused toggle is a
   *  DELIBERATE silent no-op. The one refusal reachable from a live toolbar
   *  is `toggleListCommand`'s — pressing the OTHER list kind at the top of an
   *  existing list, where `wrapInList` declines (pinned in arp-editor's
   *  formatting.test.ts) — and the honest feedback is already on screen: the
   *  pressed button doesn't change, because the dispatch that would have
   *  re-reported the active state never happened. The LINK props below are
   *  different (booleans, surfaced as inline errors) because their failures
   *  are invisible without a message. */
  readonly onToggleFormat: (format: ToggleableFormat) => void;
  /** Dispatch a heading toggle (ReportEditorHandle.toggleHeading, ticket
   *  #300): convert to the level, or back to a paragraph when the button was
   *  already active. `void` — refusals are silent, see `onToggleFormat`. */
  readonly onToggleHeading: (level: HeadingLevel) => void;
  /** Dispatch a list wrap/lift (ReportEditorHandle.toggleList, ticket #300).
   *  `void` — refusals are silent, see `onToggleFormat`. */
  readonly onToggleList: (kind: ListKind) => void;
  /** Apply a link over the current selection (ReportEditorHandle.applyLink).
   *  Called only with an href `validateLinkHref` accepted; returns whether
   *  the editor applied it. */
  readonly onApplyLink: (href: string) => boolean;
  /** Remove the link the selection sits in (ReportEditorHandle.removeLink). */
  readonly onRemoveLink: () => boolean;
  /** The "…" bubble (ticket #298): ask the host to swap this bar for the
   *  Floating composer at the same selection geometry. The host owns the
   *  composing state (it also owns the selection the composer anchors to). */
  readonly onCompose: () => void;
}

/** The link editor's inline feedback, keyed by `validateLinkHref`'s reason
 *  (plus the editor-refused fallback). User-facing copy lives here, next to
 *  the one component that renders it. */
const LINK_ERROR_MESSAGES = {
  empty: "Enter a URL.",
  unsafe: "That URL type isn't allowed.",
  refused: "The link couldn't be applied — reselect the text and try again.",
  removeRefused: "The link couldn't be removed — reselect the text and try again.",
} as const;

type LinkError = keyof typeof LINK_ERROR_MESSAGES;

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

// The URL input matches the icon buttons' metrics; `size={24}` (an HTML
// attribute, not CSS) gives it a usable baseline width even where no
// stylesheet loads (the browser-test harness has no Tailwind), so the bar's
// measured size — which drives placement — is never a zero-width degenerate.
const inputClass =
  "h-7 rounded-control border border-border bg-surface px-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 aria-[invalid=true]:border-danger";

/** The heading levels the bar exposes, in button order — arp-editor's
 *  `HeadingLevel` (1–3) spelled out so the render below can map over it. */
const HEADING_LEVELS: readonly HeadingLevel[] = [1, 2, 3];

export function SelectionToolbar({
  geometry,
  formats,
  onToggleFormat,
  onToggleHeading,
  onToggleList,
  onApplyLink,
  onRemoveLink,
  onCompose,
}: SelectionToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [size, setSize] = useState<ToolbarPlacementInput["toolbar"] | null>(null);
  // The link editor (ticket #299): open ⇄ the button row, a draft URL, and
  // the current inline error (null = none). All local — the bar owns its own
  // sub-mode; the host only sees the final applyLink/removeLink calls.
  const [linkOpen, setLinkOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [linkError, setLinkError] = useState<LinkError | null>(null);

  // Measure-then-place, re-run whenever the bar's CONTENT shape changes: the
  // link editor opening/closing (and its error line appearing) is the bar's
  // first dynamic content, so #296/#297's "measure once on mount" stopped
  // being enough at ticket #299. Plain useEffect, not useLayoutEffect —
  // this component is SSR-rendered by its smoke test and a layout effect
  // warns there; the one pre-measure frame it allows is the same settle the
  // mount-time OFFSCREEN placeholder has always accepted. Binary open/closed
  // (+ error) state keyed by deps is all this bar needs — its sub-states are
  // enumerable. The genuinely fluid surface (#298's Floating composer) is a
  // separate component with the general ResizeObserver re-measure.
  // biome-ignore lint/correctness/useExhaustiveDependencies: linkOpen/linkError are re-measure TRIGGERS (they change the rendered content whose size is being read), not values the effect body reads.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setSize({ width, height });
  }, [linkOpen, linkError]);

  // Opening the link editor moves focus into the URL input — the deliberate
  // exception to "the bar never takes focus" (see the file doc comment).
  // `select()` so a pre-filled href (edit) is replaced by just typing.
  useEffect(() => {
    if (linkOpen) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [linkOpen]);

  function openLinkEditor() {
    setDraft(formats.linkHref ?? "");
    setLinkError(null);
    setLinkOpen(true);
  }

  // Closing WITHOUT applying (Cancel, Escape) leaves keyboard focus where it
  // sits — on the just-clicked button, or nowhere (document.body) after
  // Escape — while Apply/Remove refocus the editor (applyLink/removeLink call
  // view.focus()). The asymmetry is deliberate for now: ProseMirror's STATE
  // selection persists either way (the bar stays up over it), and this
  // component has no handle to the editor to refocus with — that seam
  // (a focusEditor handle) is #298/later, not worth growing early.
  function closeLinkEditor() {
    setLinkOpen(false);
    setLinkError(null);
  }

  function submitLink() {
    const validated = validateLinkHref(draft);
    if (!validated.ok) {
      setLinkError(validated.reason);
      return;
    }
    if (!onApplyLink(validated.href)) {
      setLinkError("refused");
      return;
    }
    closeLinkEditor();
  }

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
      className={linkOpen ? "flex flex-col gap-1 p-1" : "flex items-center gap-0.5 p-1"}
      onMouseDown={(event) => event.preventDefault()}
    >
      {linkOpen ? (
        <>
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              submitLink();
            }}
          >
            <input
              ref={inputRef}
              // Plain text, not type="url": the browser's own URL validation
              // UI would compete with (and differ from) the schema-shared
              // `validateLinkHref` feedback below.
              type="text"
              size={24}
              value={draft}
              aria-label="Link URL"
              aria-invalid={linkError !== null}
              aria-describedby={linkError ? "selection-toolbar-link-error" : undefined}
              data-testid="link-url-input"
              placeholder="https://…"
              className={inputClass}
              // The one subtree allowed to take focus: stop the mousedown
              // before the container's preventDefault suppresses the focus
              // this input needs to accept typing (file doc comment).
              onMouseDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                setDraft(event.target.value);
                setLinkError(null);
              }}
              onKeyDown={(event) => {
                // Escape backs out to the button row WITHOUT dismissing the
                // bar (that is the iframe-side Escape's job, not this one).
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeLinkEditor();
                }
              }}
            />
            <button type="submit" aria-label="Apply link" className={buttonClass}>
              Apply
            </button>
            {formats.link ? (
              <button
                type="button"
                aria-label="Remove link"
                className={buttonClass}
                onClick={() => {
                  // Same refusal contract as Apply (submitLink): a `false`
                  // from the editor keeps the sub-editor open with feedback,
                  // never a silent close that looks like success.
                  if (!onRemoveLink()) {
                    setLinkError("removeRefused");
                    return;
                  }
                  closeLinkEditor();
                }}
              >
                Remove
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Cancel link"
              className={buttonClass}
              onClick={closeLinkEditor}
            >
              Cancel
            </button>
          </form>
          {linkError ? (
            <p
              id="selection-toolbar-link-error"
              role="alert"
              data-testid="link-url-error"
              className="px-1 text-sm text-danger"
            >
              {LINK_ERROR_MESSAGES[linkError]}
            </p>
          ) : null}
        </>
      ) : (
        <>
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
          <button
            type="button"
            aria-label="Link"
            aria-pressed={formats.link}
            className={formats.link ? activeButtonClass : buttonClass}
            onClick={openLinkEditor}
          >
            <span className="underline">↗</span>
          </button>
          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
          {/* Block actions (ticket #300). aria-pressed distinguishes the
              LEVEL, not just "some heading": only the button matching
              formats.headingLevel reads pressed (an H4-H6 in the document —
              retained by the schema, not exposed here — lights nothing). */}
          {HEADING_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              aria-label={`Heading ${level}`}
              aria-pressed={formats.headingLevel === level}
              className={formats.headingLevel === level ? activeButtonClass : buttonClass}
              onClick={() => onToggleHeading(level)}
            >
              <span className="text-xs font-semibold">H{level}</span>
            </button>
          ))}
          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
          <button
            type="button"
            aria-label="Bullet list"
            aria-pressed={formats.listKind === "bullet"}
            className={formats.listKind === "bullet" ? activeButtonClass : buttonClass}
            onClick={() => onToggleList("bullet")}
          >
            {/* Text glyphs, not icon components: the browser harness loads no
                Tailwind/asset pipeline, and the buttons must stay measurable
                there (same reasoning as the URL input's size attribute). */}
            <span aria-hidden="true">•</span>
          </button>
          <button
            type="button"
            aria-label="Ordered list"
            aria-pressed={formats.listKind === "ordered"}
            className={formats.listKind === "ordered" ? activeButtonClass : buttonClass}
            onClick={() => onToggleList("ordered")}
          >
            <span aria-hidden="true" className="text-xs font-semibold">
              1.
            </span>
          </button>
          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
          <button
            type="button"
            aria-label="More actions"
            className={buttonClass}
            onClick={onCompose}
          >
            <MoreIcon className="h-4 w-4" />
          </button>
        </>
      )}
    </Floating>
  );
}
