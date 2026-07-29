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
import type { PMDocJson, Shell } from "arp-report-html";
import { TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CommentForHighlight, CommentRange } from "./comment-decorations";
import {
  commentHighlightsKey,
  commentIdAtPos,
  jumpTargetForComment,
  resolvableCommentRanges,
} from "./comment-decorations";
import { createEditorState, docJson } from "./editor-state";
import { buildIframeDocument } from "./iframe-document";

/** The editor's current text selection, forwarded to the caller so it can
 *  build an ADR-0064 anchor when the user clicks "Comment" (`from === to`
 *  means an empty/collapsed selection, reported as `null`). */
export interface EditorSelection {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

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
   *  the selection is collapsed (nothing to comment on). */
  readonly onSelectionChange?: (selection: EditorSelection | null) => void;
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
}

function selectionInfo(view: EditorView): EditorSelection | null {
  const { from, to } = view.state.selection;
  if (from === to) return null;
  return { from, to, text: view.state.doc.textBetween(from, to, " ") };
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

  // Item B's "Jump": resolve the comment against the CURRENT doc and move
  // the selection there — `scrollIntoView` on the transaction makes the
  // iframe's own scroll container bring the anchor into view. Selecting the
  // full anchored range (not just a cursor at `from`) doubles as a visual
  // "this is the spot" flash without any extra decoration machinery.
  useImperativeHandle(
    ref,
    () => ({
      jumpToComment(comment) {
        const view = viewRef.current;
        if (!view) return false;
        const target = jumpTargetForComment(view.state.doc.content.size, comment);
        if (!target) return false;
        const tr = view.state.tr
          .setSelection(TextSelection.create(view.state.doc, target.from, target.to))
          .scrollIntoView();
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

    function mount() {
      if (cancelled || viewRef.current) return; // idempotent: a double signal is safe.
      const body = iframe?.contentDocument?.body;
      if (!body) return; // defensive — shouldn't happen once `load` has fired.

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
            onSelectionChangeRef.current?.(selectionInfo(view));
          },
          // Item B: a click inside a comment highlight surfaces that
          // comment in the panel. Returning false leaves ProseMirror's own
          // click handling (caret placement, selection) untouched — this
          // observes the click, it never consumes it.
          handleClick(clickedView, pos) {
            const commentId = commentIdAtPos(commentHighlightsKey.getState(clickedView.state), pos);
            if (commentId) onCommentClickRef.current?.(commentId);
            return false;
          },
        },
      );
      viewRef.current = view;

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
