// The client-only ProseMirror editor surface (ADR-0062). Mounted in a
// `useEffect` because `EditorView` needs a real DOM — Remix SSR must never
// try to construct one. No toolbar (editor MVP scope): typing plus the
// Mod-b / Mod-i / Mod-z keymap bindings from `editorPlugins()` are the whole
// interaction surface. The pure state/keymap wiring lives in
// `../editor/editor-state` (unit-tested there); this component only owns the
// DOM mount/teardown and forwards doc-changed / selection-changed events to
// the caller.
//
// STYLING FIX (editor styling/structure fix, Fix 1): the report's own
// presentation shell (`<style>` + `<body>` attrs, ADR-0062 §2) never reached
// the client before this — the loader discarded `shell`, and PM mounted into
// a bare `<div class="report-editor prose …">` with no CSS backing it, so
// every bespoke class (chips/cards/sections/…) rendered unstyled. Now the
// EditorView mounts INSIDE a same-origin, CSP-restricted, sandboxed <iframe>
// built from that shell (`../editor/iframe-document.ts`'s
// `buildIframeDocument`) — the iframe's <body> (carrying the shell's own
// body classes/attrs) becomes ProseMirror's editable root via the `mount:`
// option, so `{ mount: iframeBody }` rather than the usual `new
// EditorView(host, …)` (which would instead APPEND a wrapper div inside
// `host`, one extra DOM layer we don't want — we want the body itself, with
// its original classes, to be the PM root, matching the source document's
// top-level structure exactly).
//
// Report CSS is isolated automatically (it's inside the iframe's own
// document, never the parent's) — the dashboard's tailwind.css is
// unaffected, and vice versa: the sandboxed CSP (see iframe-document.ts)
// blocks the untrusted shell CSS from exfiltrating anything.
//
// Comment highlighting (ADR-0064 §2a, editor comment UI slice): `comments`
// feeds the pure `resolvableCommentRanges` (comment-decorations.ts), and the
// result is pushed into the mounted view's decoration plugin via
// `tr.setMeta(commentHighlightsKey, ranges)` whenever the `comments` prop
// changes (a fetcher revalidation after add/reply/resolve). Ordinary typing
// transactions carry no such meta — the plugin re-maps existing decorations
// through ProseMirror's own position mapping instead (best-effort: an edit
// that invalidates a range just stops highlighting it, ADR-0064 §2a). The
// `.comment-highlight` CSS rules (base + per-intent modifiers, item A) live
// in the iframe's injected style (iframe-document.ts's
// `IFRAME_INJECTED_CSS`), since they have to be in the SAME document as the
// decorated spans.
//
// Bidirectional linking (comment-UX adoptions, item B): `onCommentClick`
// fires with the clicked highlight's comment id (via `EditorView`'s
// `handleClick` prop + the pure `commentIdAtPos`), and the forwarded ref
// exposes `jumpToComment` — resolve the comment's anchor against the CURRENT
// doc (`jumpTargetForComment`) and scroll the selection there. Both are
// best-effort: a degraded anchor makes `jumpToComment` return `false` and a
// click outside any highlight fires nothing. `onCommentRangesChange` reports
// each seeding's RESOLVED ranges back to the caller — the panel uses it for
// document-order sorting and the degraded-anchor badge (items C/D) without
// re-implementing position resolution outside this package.
//
// Link activation (ADR-0062 Amendment 3): the editing surface is
// `contenteditable`, where browsers never follow an anchor — a click only
// places a caret — so links looked broken in `/edit`. The same
// `handleDOMEvents.click` handler now also resolves the link under the
// pointer through the ProseMirror MODEL (`posAtCoords` → `linkMarkAtPos`,
// never `event.target.closest("a")`: the iframe is a different JS realm) and
// applies the pure rules in `link-activation.ts`. A plain click follows the
// link, Alt/Option+click suppresses it, and link activation WINS over comment
// focus when both apply (`editorClickOutcome`, pinned by test). The two
// effects are injectable props so the decision logic stays DOM-free; both
// defaults live in the mount closure below.
import type { PMDocJson, Shell } from "arp-report-html";
import { EditorView } from "prosemirror-view";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ClickPoint } from "./click-gesture";
import type { CommentForHighlight, CommentRange } from "./comment-decorations";
import {
  clickedCommentId,
  commentHighlightsKey,
  resolvableCommentRanges,
} from "./comment-decorations";
import type { EditorSelection } from "./editor-state";
import {
  anchorScrollTransaction,
  createEditorState,
  currentSelection,
  docJson,
  isProgrammaticSelection,
  jumpToCommentTransaction,
  reportableSelection,
} from "./editor-state";
import { buildIframeDocument } from "./iframe-document";
import {
  editorClickOutcome,
  linkActivation,
  linkMarkAtPos,
  scrollAnchorIntoView,
} from "./link-activation";
import { type SelectionGeometry, selectionGeometry, shouldComputeGeometry } from "./selection-rect";

// Re-exported for callers that import it from this module (the type moved to
// editor-state.ts so the pure selection-reporting gate is testable DOM-free).
export type { EditorSelection } from "./editor-state";

/** Imperative surface exposed via the forwarded ref (item B's "Jump"). */
export interface ReportEditorHandle {
  /** Scroll the editor to the comment's anchor position, selecting the
   *  anchored range. Returns `false` (and does nothing) when the comment's
   *  relative position no longer resolves against the current doc — the
   *  degraded, version-pinned state has nowhere live to jump to. */
  readonly jumpToComment: (comment: CommentForHighlight) => boolean;
}

export interface ReportEditorProps {
  /** The document to open — the lossless `_source.json` sidecar, or a
   *  best-effort HTML→PM parse when none exists yet (ADR-0062 §4). Read only
   *  at mount: the editor owns its own state thereafter. */
  readonly initialDoc: PMDocJson;
  /** The report's presentation shell (ADR-0062 §2) — `<style>` plus the
   *  original `<body>` tag's own classes/attributes. Read only at mount
   *  (same rule as `initialDoc`): it's what `buildIframeDocument` turns into
   *  the sandboxed iframe's `srcDoc`. */
  readonly shell: Shell;
  /** Fired after every transaction that changes the document, with the
   *  current doc as PM JSON — the caller keeps the latest value (a ref is
   *  enough; no need to re-render on every keystroke) for Save. */
  readonly onChange: (doc: PMDocJson) => void;
  /** Fired after every transaction with the current selection, or `null` when
   *  the selection is collapsed (nothing to comment on). The second argument
   *  is WHERE that selection sits — its bounding rect + the editing surface's
   *  rect, both already translated into the HOST page's viewport coordinates
   *  (selection-rect.ts) — for selection-anchored floating UI (the Selection
   *  toolbar, ticket #296). It is `null` whenever the selection is, and ALSO
   *  null mid-drag: a floating bar must not appear under a moving pointer, so
   *  geometry is withheld until the mouseup re-report. Callers that only care
   *  about the selection itself can ignore the argument entirely. */
  readonly onSelectionChange?: (
    selection: EditorSelection | null,
    geometry: SelectionGeometry | null,
  ) => void;
  /** Fired when Escape is pressed inside the editing surface (observed, never
   *  consumed — PM's own handling still runs). The iframe's key events never
   *  reach the host window, so a host hiding selection-anchored UI on Escape
   *  needs this seam. */
  readonly onEscape?: () => void;
  /** Fired when the report document scrolls inside the editing iframe.
   *  Scrolling produces NO ProseMirror transaction, so previously-reported
   *  selection geometry silently goes stale — hosts use this to dismiss
   *  selection-anchored UI rather than let it drift (ticket #296). */
  readonly onDocScroll?: () => void;
  /** Comments to render as highlight decorations (best-effort — see the file
   *  doc comment). Read reactively: a new array reference re-seeds the
   *  decoration set, mapped against the CURRENT doc's bounds. */
  readonly comments?: readonly CommentForHighlight[];
  /** Fired when the user clicks inside a comment highlight, with that
   *  comment's id (item B: click-highlight → focus the panel comment). */
  readonly onCommentClick?: (commentId: string) => void;
  /** Fired with the RESOLVED highlight ranges each time the `comments` prop
   *  is (re)seeded — a comment absent from the reported ranges did not
   *  resolve against the current doc (degraded / version-pinned, item D). */
  readonly onCommentRangesChange?: (ranges: readonly CommentRange[]) => void;
  /** Applied to the mounted `<iframe>` element itself (sizing/borders) — NOT
   *  a typography/prose class anymore: the iframe's own document carries the
   *  report's real CSS, so there's nothing left for the parent's classes to
   *  style on the inside. */
  readonly className?: string;
  /** Perform an external link activation (ADR-0062 Amendment 3). Injected so
   *  the decision logic stays unit-testable; the default opens a new tab.
   *  THE PARENT PERFORMS IT: this handler is parent-realm code, and the
   *  editing iframe deliberately has no `allow-popups`, so the iframe itself
   *  could not open a tab even if the click were followed there. Do NOT add
   *  `allow-popups` to that iframe to "fix" this. */
  readonly onOpenExternalLink?: (url: string) => void;
  /** Scroll an in-page anchor into view (ADR-0062 Amendment 3). Injected for
   *  the same reason; the default scrolls the iframe's own document. */
  readonly onAnchorNavigate?: (targetId: string) => void;
}

export const ReportEditor = forwardRef<ReportEditorHandle, ReportEditorProps>(function ReportEditor(
  {
    initialDoc,
    shell,
    onChange,
    onSelectionChange,
    comments,
    onCommentClick,
    onCommentRangesChange,
    className,
    onOpenExternalLink,
    onAnchorNavigate,
    onEscape,
    onDocScroll,
  },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const viewRef = useRef<EditorView>();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  const onCommentClickRef = useRef(onCommentClick);
  onCommentClickRef.current = onCommentClick;
  const onCommentRangesChangeRef = useRef(onCommentRangesChange);
  onCommentRangesChangeRef.current = onCommentRangesChange;
  const onOpenExternalLinkRef = useRef(onOpenExternalLink);
  onOpenExternalLinkRef.current = onOpenExternalLink;
  const onAnchorNavigateRef = useRef(onAnchorNavigate);
  onAnchorNavigateRef.current = onAnchorNavigate;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const onDocScrollRef = useRef(onDocScroll);
  onDocScrollRef.current = onDocScroll;

  // Item B's "Jump": resolve the comment against the CURRENT doc and move
  // the selection there — `scrollIntoView` on the transaction makes the
  // iframe's own scroll container bring the anchor into view. Selecting the
  // full anchored range (not just a cursor at `from`) doubles as a visual
  // "this is the spot" flash without any extra decoration machinery. The
  // transaction is built by the pure `jumpToCommentTransaction`, which flags
  // it as programmatic so `reportableSelection` (dispatchTransaction below)
  // reports `null` — a Jump must reveal the anchor, never open the
  // new-comment composer (2026-07-29 dogfood paper cut #1).
  useImperativeHandle(
    ref,
    () => ({
      jumpToComment(comment) {
        const view = viewRef.current;
        if (!view) return false;
        const tr = jumpToCommentTransaction(view.state, comment);
        if (!tr) return false;
        view.dispatch(tr);
        view.focus();
        return true;
      },
    }),
    [],
  );

  // `srcDoc` is built on the CLIENT only. `buildIframeDocument` parses with the
  // browser's `DOMParser` (comment-aware, per the CSP-bypass fix) — which does
  // NOT exist during Remix SSR on the Node serverless function. Computing it in
  // a render-time `useMemo` therefore threw `ReferenceError: DOMParser is not
  // defined` and 500'd the AUTHENTICATED editor (SSR runs `ReportEditor`; an
  // unauthenticated request redirects to /sign-in before it renders, which is
  // why it looked fine). This component is client-only anyway (`EditorView`
  // needs a real DOM), so we build `srcDoc` in a mount effect: SSR + first
  // client render emit an `<iframe>` with no `srcDoc` (identical, no hydration
  // mismatch); the client then sets it, the iframe's `load` fires, and the
  // mount effect below mounts PM into it. Read only at mount (`[]`), same
  // contract as `initialDoc`, so no accidental re-navigation on a `comments`
  // change.
  const [srcDoc, setSrcDoc] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: shell is read only at mount by design, mirroring initialDoc.
  useEffect(() => {
    setSrcDoc(buildIframeDocument(shell));
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: initialDoc is read only at mount by design (see the prop doc-comment) — the parent remounts via a `key` change (e.g. the slug) to load a genuinely different document.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let cancelled = false;
    let removeScrollListener: (() => void) | null = null;

    function mount() {
      if (cancelled || viewRef.current) return; // idempotent: a double signal is safe.
      const body = iframe?.contentDocument?.body;
      if (!body) return; // defensive — shouldn't happen once `load` has fired.

      // Item B: a click inside a comment highlight surfaces that comment in
      // the panel. Wired through RAW DOM events (`handleDOMEvents`), NOT the
      // `handleClick` prop (2026-07-29 dogfood E3 fix): PM's `handleClick`
      // rides its internal `MouseDown` tracker, which Chrome kills between
      // mousedown and mouseup inside this sandboxed iframe by synthesizing a
      // `mousemove` with `buttons === 0` at the unmoved cursor position
      // (prosemirror-view reads `buttons === 0` as "button released outside
      // the window" and drops the tracker) — so `handleClick` NEVER fired on
      // the mounted editor even though its pure lookup was unit-tested. The
      // native `click` event is delivered regardless of PM's tracker; the
      // drag-vs-click discrimination (`clickedCommentId`) is ours. Both
      // handlers return false — they observe, never consume.
      let pointerDown: ClickPoint | null = null;
      // The drag flag for geometry withholding (ticket #296) — SEPARATE from
      // `pointerDown` on purpose (claude-review #301 M-1): `pointerDown` is
      // cleared only in `click`, and a gesture that never yields a click (a
      // cross-block drag, a right-button press, a release outside the
      // surface) would leave a shared flag stuck and silently withhold
      // geometry from every later keyboard-extended selection. This one is
      // set on mousedown and cleared on EVERY mouseup, so it can wedge only
      // for a release outside the iframe — which self-heals on the next
      // press.
      let dragging = false;
      // Whether the most recent transaction was a programmatic reveal (Jump,
      // anchor scroll). The mouseup re-report below reads state, not a
      // transaction, so without this latch a primary-button release landing
      // while a Jump-set selection still stands would re-report it as a
      // GENUINE user selection — re-opening the composer/toolbar the
      // programmatic gate exists to suppress (claude-review #301 H-1).
      let lastSelectionProgrammatic = false;

      // The one path every selection report takes (ticket #296). Geometry —
      // where the selection sits, in HOST viewport coordinates — rides along
      // with the selection so hosts can float UI over it, EXCEPT mid-drag
      // (`shouldComputeGeometry`, pure): a bar appearing under a moving
      // pointer would flicker and swallow the drag's own mouse events, so
      // drags report their geometry only from the `mouseup` handler below,
      // Notion-style. `coordsAtPos` speaks iframe-viewport coordinates; the
      // pure `selectionGeometry` unions start/end and translates by the
      // iframe's own bounding rect. Side `-1` on `to` reads the coords of
      // the selection's LAST character rather than the position after it
      // (which on a line break would be the start of the next line).
      function reportSelection(
        selection: EditorSelection | null,
        forView: EditorView,
        midDrag: boolean,
      ) {
        let geometry: SelectionGeometry | null = null;
        if (shouldComputeGeometry(selection, midDrag) && selection && iframe) {
          geometry = selectionGeometry(
            forView.coordsAtPos(selection.from),
            forView.coordsAtPos(selection.to, -1),
            iframe.getBoundingClientRect(),
          );
        }
        onSelectionChangeRef.current?.(selection, geometry);
      }

      // The two link-activation EFFECTS (ADR-0062 Amendment 3). Both defer
      // to an injected prop when the caller supplied one; the defaults below
      // are what makes the feature work with no wiring at the call site.

      function openExternalLink(url: string) {
        if (onOpenExternalLinkRef.current) {
          onOpenExternalLinkRef.current(url);
          return;
        }
        // Opened from the PARENT window, not the iframe: the editing iframe
        // is `sandbox="allow-same-origin"` with no `allow-popups`, so it
        // cannot open a tab itself — and it must not be given that token
        // (see the sandbox rationale on the <iframe> below). `noopener,
        // noreferrer` regardless of what the link's own `rel` says: the
        // schema forces those tokens too, and this is the second belt.
        window.open(url, "_blank", "noopener,noreferrer");
      }

      function scrollToAnchor(targetId: string, view: EditorView) {
        if (onAnchorNavigateRef.current) {
          onAnchorNavigateRef.current(targetId);
          return;
        }
        const element = iframe?.contentDocument?.getElementById(targetId);

        // STEP 1 — TOP-ALIGN THE ANCHOR, SYNCHRONOUSLY, BEFORE ANYTHING ELSE.
        //
        // THIS USED TO BE STEP 2, deferred an animation frame, re-resolving
        // the anchor by `id` inside that frame. The operator's round-five
        // production trace is why it is neither any more. Instrumented on the
        // realm the call actually resolves through (the PARENT's
        // `Element.prototype` — see the realm note in link-activation.ts), a
        // real anchor click on the live `/edit` page reads:
        //
        //     caretHost:    "H2#section-two"
        //     trace:        [ { kind: "scrollBy", args: "[0,77.9453125]", y: 0 } ]
        //     finalScrollY: 78      targetTop: 609 (was 687)
        //
        // The caret transaction below lands, ProseMirror's own minimal reveal
        // fires — and the alignment pass does not run at all. Running the same
        // instrument over the browser tier's `plain-report.html` reads the
        // same viewport (647), the same anchor position (687) and the same
        // `scrollBy(0, 77.9)`, and then DOES record the alignment call. So the
        // divergence is entirely between the dispatch below and this call.
        //
        // WHAT MAKES PRODUCTION SKIP IT IS STILL NOT ESTABLISHED. What IS
        // established is that the old ordering gave it three ways to be
        // skipped without leaving any trace, and this ordering has none:
        //
        //  - it no longer runs downstream of `view.dispatch(...)`.
        //    prosemirror-view 1.42.0 wraps a `handleDOMEvents` handler in no
        //    try/catch (`runCustomHandler`, dist/index.js:3145), so anything
        //    throwing inside that dispatch — a caller's own
        //    `onSelectionChange` included — would abort the click handler
        //    after PM has applied the caret and scrolled, leaving exactly the
        //    trace above. REFUTED IN PRODUCTION (round 6): with `error` and
        //    `unhandledrejection` armed on the parent window and the console
        //    reader running, the bug reproduced on the click and NOTHING was
        //    captured — and with no try/catch to swallow it, a throw would
        //    have surfaced. Kept as a removed surface, not as a candidate;
        //  - it no longer waits on a parent-window animation frame that has
        //    never been observed running in the production page — STILL LIVE;
        //  - it no longer re-resolves an element already in hand, which could
        //    return nothing, or (the same call, a different failure) the FIRST
        //    element in document order with that id rather than the one the
        //    handler resolved — STILL LIVE.
        //
        // Both properties are contracts in tests/browser/anchor-scroll.spec.ts
        // ("does not depend on a later animation frame", "survives a caller
        // callback that throws mid-dispatch"); both are RED against the
        // previous ordering, and neither is a reproduction of the production
        // failure. Since round 6 the second is a DEFENSIVE invariant — the
        // missing try/catch is real and worth not depending on — rather than a
        // candidate explanation. Do not read any of this as a diagnosis.
        //
        // ORDERING IT FIRST COSTS NOTHING. PM's reveal scrolls only as far as
        // it must (`scrollRectIntoView`); with the anchor already top-aligned
        // the caret is on screen, so PM computes a zero move and the surface
        // is scrolled exactly once instead of twice. The element lookup
        // crosses into the iframe's DOCUMENT because that is the only document
        // it is in; whose realm built it is a separate question, answered on
        // the realm note in link-activation.ts.
        scrollAnchorIntoView(element);

        // STEP 2 — MOVE PROSEMIRROR'S CARET TO THE ANCHOR.
        //
        // This is what the original implementation was missing, and why the
        // feature shipped inert. A click leaves PM's selection ON THE TOC
        // LINK, and PM scrolls for a transaction only when that transaction
        // called `.scrollIntoView()` (`updateStateInner`'s `state
        // .scrollToSelection > prev.scrollToSelection` test) — so a scroll
        // issued behind PM's back has no standing, and anything that later
        // reveals the caret is free to drag the document back to the link.
        // Measured in Chrome against a modelled competitor: such a scroll
        // loses whatever we do, and a `behavior: "smooth"` one loses worst,
        // because it is an abortable animation running for hundreds of
        // milliseconds and any competing scroll abandons it permanently.
        //
        // WHETHER SUCH A COMPETITOR EXISTS IN PRODUCTION, and if so WHICH
        // mechanism it is, is NOT established — three candidates have been
        // checked against prosemirror-view's source and refuted, and the
        // browser tier has never reproduced the reported failure at all.
        // `anchorScrollTransaction`'s doc comment (editor-state.ts) carries the
        // full account; read it before repeating any causal story about this.
        //
        // Deferring by MORE frames cannot fix it either: the caret never
        // stops being somewhere else. So don't out-run the competitor —
        // remove it. Once the caret is at the anchor, any reveal of the caret
        // re-asserts the jump instead of undoing it. Same mechanism the
        // comment "Jump" has always used — literally the same builder,
        // `programmaticRevealTransaction`.
        //
        // `posAtDOM` is the model-side lookup for a DOM node PM rendered; it
        // throws for a node PM does not own (an element from the shell),
        // which is what the try/catch covers.
        if (element) {
          let pos: number | null = null;
          try {
            pos = view.posAtDOM(element as unknown as Node, 0);
          } catch {
            pos = null; // not a node ProseMirror rendered — step 1 already aligned it.
          }
          const tr = pos === null ? null : anchorScrollTransaction(view.state, pos);
          if (tr) view.dispatch(tr);
        }
      }

      const view = new EditorView(
        // `{ mount: body }` makes the iframe's OWN <body> — carrying the
        // shell's original classes/attributes — the PM editable root
        // directly, rather than the default behavior of appending a new
        // wrapper div inside it (which would add a DOM layer the report's
        // CSS never accounted for).
        { mount: body },
        {
          state: createEditorState(initialDoc),
          dispatchTransaction(tr) {
            const next = view.state.apply(tr);
            view.updateState(next);
            if (tr.docChanged) onChangeRef.current(docJson(next));
            lastSelectionProgrammatic = isProgrammaticSelection(tr);
            reportSelection(reportableSelection(tr, next), view, dragging);
          },
          handleDOMEvents: {
            mousedown(_view, event) {
              pointerDown = { x: event.clientX, y: event.clientY };
              dragging = true;
              return false;
            },
            mouseup(upView, event) {
              // The drag's own selection transactions fired during mousemove
              // with geometry withheld (see reportSelection); the release is
              // when the Selection toolbar may appear, and no new transaction
              // fires here — so re-report from the STATE (`currentSelection`,
              // the same trimmed reading minus the transaction gate). Three
              // guards stand in for the gate a transaction would carry:
              // only a PRIMARY-button release (a right-click's mouseup must
              // not re-surface whatever selection stands — e.g. one a Jump
              // just set), only when a press in this surface started the
              // gesture, and never while the latest transaction was a
              // programmatic reveal (H-1). Deliberately does NOT clear
              // `pointerDown`: the `click` handler below still needs the
              // down point for its click-vs-drag discrimination, and it
              // fires after mouseup.
              const startedHere = dragging;
              dragging = false;
              if (event.button !== 0 || !startedHere || lastSelectionProgrammatic) return false;
              reportSelection(currentSelection(upView.state), upView, false);
              return false;
            },
            keydown(_view, event) {
              // Observed, never consumed: Escape dismisses selection-anchored
              // host UI (ticket #296); the iframe's key events don't reach
              // the host window, so this is the host's only seam for it.
              if (event.key === "Escape") onEscapeRef.current?.();
              return false;
            },
            click(clickedView, event) {
              const down = pointerDown;
              pointerDown = null;
              const up = { x: event.clientX, y: event.clientY };

              // LINK ACTIVATION (ADR-0062 Amendment 3). The editing surface
              // is `contenteditable`, so the browser never activates an
              // anchor here on its own — a click only places a caret. That
              // is the whole reported bug, and handling the click ourselves
              // is the only thing that fixes it.
              //
              // The link under the cursor is resolved through ProseMirror's
              // MODEL (`posAtCoords` → `linkMarkAtPos`), never
              // `event.target.closest("a")` — because a link here is a MARK on
              // text rather than an element, and the mark set at the position
              // is the authority on where it starts and ends. (This comment
              // used to justify it with "the iframe is a different JS realm
              // where `instanceof` against the parent's constructors is
              // false". That is backwards for PM-rendered nodes and it is
              // corrected on `AnchorScrollDeps` in link-activation.ts.)
              const found = clickedView.posAtCoords({ left: up.x, top: up.y });
              const outcome = editorClickOutcome(
                linkActivation({
                  link: found ? linkMarkAtPos(clickedView.state, found.pos) : null,
                  down,
                  up,
                  altKey: event.altKey,
                }),
                clickedCommentId(
                  commentHighlightsKey.getState(clickedView.state),
                  down,
                  up,
                  (point) => clickedView.posAtCoords(point),
                ),
              );

              if (outcome?.kind === "external") {
                openExternalLink(outcome.url);
              } else if (outcome?.kind === "anchor") {
                scrollToAnchor(outcome.targetId, clickedView);
              } else if (outcome?.kind === "comment") {
                onCommentClickRef.current?.(outcome.commentId);
              }
              // Still observational: PM keeps its own default handling
              // (caret placement) either way, exactly as before.
              return false;
            },
          },
        },
      );
      viewRef.current = view;

      // A scroll inside the editing iframe produces NO ProseMirror
      // transaction, so a host floating UI over previously-reported selection
      // geometry has no way to learn it went stale — tell it (ticket #296).
      // On the WINDOW because the report's scroll container varies by
      // document (the fixture scrolls the window, a report could scroll a
      // nested box); `capture` catches nested scrolls too, since scroll
      // events don't bubble but do run ancestors' capture phase.
      const win = iframe?.contentWindow;
      if (win) {
        const onScroll = () => onDocScrollRef.current?.();
        win.addEventListener("scroll", onScroll, { capture: true, passive: true });
        removeScrollListener = () => win.removeEventListener("scroll", onScroll, { capture: true });
      }

      // Seed the initial comment highlight decorations (Fix 2) — the
      // `comments`-keyed effect below only re-seeds on a LATER change, so
      // whatever comments are already present at mount time need seeding
      // here too.
      const ranges = resolvableCommentRanges(
        view.state.doc.content.size,
        commentsRef.current ?? [],
      );
      if (ranges.length > 0) {
        view.dispatch(view.state.tr.setMeta(commentHighlightsKey, ranges));
      }
      onCommentRangesChangeRef.current?.(ranges);
    }

    // Mount timing (claude-review #171 finding 1): a freshly-rendered `srcdoc`
    // iframe can momentarily expose the initial `about:blank` document, which
    // ALSO reports `readyState === "complete"` — mounting into that blank body
    // (no shell classes/`<style>`) would orphan the view when the real srcdoc
    // document replaces it, with no remount (the `load` listener wouldn't have
    // been attached on that branch). So gate on a POSITIVE sentinel that only
    // the srcdoc document carries — its `documentURI` is `about:srcdoc`, never
    // `about:blank` — and ALWAYS also listen for `load` (re-checking the same
    // sentinel). `mount()` is idempotent, so a double signal is harmless.
    function tryMount() {
      const doc = iframe?.contentDocument;
      if (doc?.readyState === "complete" && doc.documentURI?.startsWith("about:srcdoc")) {
        mount();
      }
    }
    tryMount();
    iframe.addEventListener("load", tryMount);

    return () => {
      cancelled = true;
      iframe.removeEventListener("load", tryMount);
      removeScrollListener?.();
      viewRef.current?.destroy();
      viewRef.current = undefined;
    };
  }, []);

  // Re-seed the comment highlight decorations whenever the comments list
  // changes (new comment added, or the sidebar's revalidated list arrives),
  // and report the resolved ranges back to the caller (items C/D).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const ranges = resolvableCommentRanges(view.state.doc.content.size, comments ?? []);
    view.dispatch(view.state.tr.setMeta(commentHighlightsKey, ranges));
    onCommentRangesChangeRef.current?.(ranges);
  }, [comments]);

  return (
    <iframe
      ref={iframeRef}
      title="Report editor surface"
      // SECURITY (ADR-0062 §9 amendment — editor styling/structure fix):
      // `allow-same-origin` is required so the parent can reach
      // `contentDocument`/mount PM into it at all — a sandboxed iframe
      // WITHOUT it gets an opaque origin, which blocks cross-document DOM
      // access entirely (not just script execution). Deliberately NOT
      // `allow-scripts`: PM's `EditorView` attaches native DOM event
      // listeners (keydown/input/mousedown/etc.) from the PARENT's JS
      // context — that's a same-origin DOM operation, not "script execution
      // inside the iframe's own document," so it works without it. The
      // iframe's own document never contains a `<script>` tag anyway
      // (`buildIframeDocument` never emits one), and the CSP's `default-src
      // 'none'` would block one even if the shell somehow smuggled it in.
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
      className={className}
    />
  );
});
