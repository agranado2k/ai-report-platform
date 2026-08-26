// The Floating composer (ticket #298): the comment composer the Selection
// toolbar's "…" bubble swaps in, anchored at the SAME selection geometry the
// toolbar used. It is the SOLE creation path for selection-anchored root
// comments in the unified experience — selecting text no longer auto-opens
// the side panel's composer (that contract is retired in the same change);
// the panel remains the home for reading Threads, replies, resolve and edit.
//
// The POST is injectable (`onSubmit`), not wired to the comments client here:
// the /edit route builds the ADR-0064 anchor from ITS stored selection +
// current versionId and calls `addComment` with the live edit token, while
// the browser-test harness (tests/browser/harness/entry.tsx) wires a local
// stub — the same seam that lets the browser tier assert the highlight and
// panel side effects with no network. A failed post surfaces inline
// (role="alert") with the typed body preserved — the comment is never lost;
// only a SUCCESSFUL post closes the composer (the parent owns that state).
//
// Placement is the SelectionToolbar's measure-then-place, upgraded to the
// GENERAL re-measure that file's comments promised for #298: the composer's
// size is genuinely fluid (the body grows as the user types, the error line
// appears and disappears), so instead of keying an effect on an enumerated
// list of sub-states, a ResizeObserver re-measures on ANY rendered-size
// change — chosen over a re-measure keyed on [body, error] because the
// observer follows the element's real box (including native textarea
// resizing) rather than a hand-maintained trigger list. The mount effect
// still measures once synchronously so the first placement doesn't wait for
// the observer's first tick; SSR (the smoke test) renders the OFFSCREEN
// position, and the observer is guarded for environments without
// ResizeObserver.
//
// Focus + selection: `autoFocus` on the body moves focus OUT of the editing
// iframe, hiding the VISUAL selection — the same accepted trade the link URL
// input documents (SelectionToolbar's file comment): ProseMirror's STATE
// selection persists regardless, and the route builds the anchor from its
// STORED selection, not the visual one. The container's
// `onMouseDown={preventDefault}` keeps every non-field click from stealing
// focus; the text fields are the exception subtree and stop propagation.
//
// Keyboard: `handleComposerKeyDown` (../composer-keys.ts) — the ONE composer
// keyboard convention (⌘/Ctrl+Enter submits, Escape cancels, everything else
// stops propagating so document-level handlers never see composer
// keystrokes). Its stopPropagation is what layers the Escape semantics:
// Escape HERE cancels the composer (back to the toolbar, document selection
// intact) and never reaches the editor's own Escape dismissal.
import type { Intent } from "arp-domain";
import {
  placeToolbar,
  type SelectionGeometry,
  type ToolbarPlacementInput,
  type ToolbarPosition,
} from "arp-editor";
import { Button, Floating, Select, Textarea } from "arp-ui";
import { useEffect, useRef, useState } from "react";
import { handleComposerKeyDown } from "../composer-keys";
import { INTENT_OPTIONS } from "../intent-options";

/** What a submitted draft came back as: posted, or failed with a
 *  human-facing message the composer renders inline. */
export type ComposerSubmitResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/** The draft the composer hands to its injected post action. */
export interface ComposerDraft {
  readonly body: string;
  readonly intent: Intent;
}

export interface FloatingComposerProps {
  /** Where the selection sits on the host page — the SAME geometry the
   *  Selection toolbar was placed by (the composer swaps in at its anchor). */
  readonly geometry: SelectionGeometry;
  /** The selected text being commented on, rendered as the quote line. */
  readonly quote: string;
  /** Post the draft. The route wires the real comments-client call (anchor +
   *  edit token live there); the browser harness wires a local stub. Resolve
   *  `{ ok: false }` to keep the composer open with an inline error and the
   *  body preserved; on `{ ok: true }` the PARENT unmounts the composer. */
  readonly onSubmit: (draft: ComposerDraft) => Promise<ComposerSubmitResult>;
  /** Dismiss without posting (Escape / the Cancel button). The document
   *  selection is untouched — the parent decides what shows next. */
  readonly onCancel: () => void;
}

/** Rendered-but-unmeasured (and SSR) position: parked far offscreen so the
 *  measuring first paint is never visible (same as SelectionToolbar). */
const OFFSCREEN: ToolbarPosition = { left: -9999, top: -9999, placement: "above" };

/** Mirrors the quote truncation the panel's thread cards use — the bubble
 *  quotes enough to orient, never the whole selection. */
const QUOTE_MAX = 80;

export function FloatingComposer({ geometry, quote, onSubmit, onCancel }: FloatingComposerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ToolbarPlacementInput["toolbar"] | null>(null);
  const [body, setBody] = useState("");
  const [intent, setIntent] = useState<Intent>("note");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The GENERAL re-measure (see the file doc comment): once on mount for the
  // first placement, then a ResizeObserver for every later size change.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      // Bail on no-change so the observer can never ping-pong with React:
      // placement only moves the (fixed-position) box, it never resizes it.
      setSize((prev) =>
        prev && prev.width === width && prev.height === height ? prev : { width, height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  async function submit() {
    if (busy || !body.trim()) return;
    setBusy(true);
    setError(null);
    const result = await onSubmit({ body, intent });
    setBusy(false);
    if (!result.ok) {
      // The body is untouched — a failed post never loses the comment.
      setError(result.message);
    }
  }

  const placed = size
    ? placeToolbar({ selection: geometry.rect, toolbar: size, bounds: geometry.surface })
    : OFFSCREEN;

  return (
    <Floating
      ref={ref}
      left={placed.left}
      top={placed.top}
      role="dialog"
      aria-label="New comment"
      data-testid="floating-composer"
      data-placement={placed.placement}
      className="flex w-72 flex-col gap-2 p-3"
      onMouseDown={(event) => event.preventDefault()}
    >
      <p className="text-xs text-subtle" data-testid="floating-composer-quote">
        Commenting on: <span className="italic text-muted">"{quote.slice(0, QUOTE_MAX)}"</span>
      </p>
      <Textarea
        value={body}
        // Focus moves here on open — the accepted iframe-blur trade the file
        // doc comment covers (opening the composer IS the intent to type,
        // same as the link editor's programmatic focus).
        autoFocus
        rows={3}
        // Native cols: a usable intrinsic width even where no stylesheet
        // loads (the browser-test harness has no Tailwind), so the measured
        // size driving placement is never a zero-width degenerate — same
        // reasoning as the link URL input's `size` attribute.
        cols={28}
        aria-label="Comment body"
        data-testid="floating-composer-body"
        placeholder="Add a comment…"
        className="w-full"
        // The focus-taking exception subtree (see the file doc comment).
        onMouseDown={(event) => event.stopPropagation()}
        onChange={(event) => {
          setBody(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) =>
          handleComposerKeyDown(event, {
            onSubmit: () => {
              if (!busy) void submit();
            },
            onCancel: () => {
              if (!busy) onCancel();
            },
          })
        }
      />
      {error ? (
        <p role="alert" data-testid="floating-composer-error" className="text-xs text-danger">
          ✗ {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs text-subtle">
          <span id="floating-composer-intent-label">Intent</span>
          <Select
            size="sm"
            aria-labelledby="floating-composer-intent-label"
            data-testid="floating-composer-intent"
            value={intent}
            disabled={busy}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => setIntent(event.target.value as Intent)}
          >
            {INTENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Cancel comment"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            aria-label="Post comment"
            onClick={submit}
            disabled={busy || !body.trim()}
          >
            {busy ? "Posting…" : "Comment"}
          </Button>
        </div>
      </div>
    </Floating>
  );
}
