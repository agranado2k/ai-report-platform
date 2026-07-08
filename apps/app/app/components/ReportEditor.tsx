// The client-only ProseMirror editor surface (ADR-0062). Mounted in a
// `useEffect` because `EditorView` needs a real DOM — Remix SSR must never
// try to construct one. No toolbar (editor MVP scope): typing plus the
// Mod-b / Mod-i / Mod-z keymap bindings from `editorPlugins()` are the whole
// interaction surface. The pure state/keymap wiring lives in
// `../editor/editor-state` (unit-tested there); this component only owns the
// DOM mount/teardown and forwards doc-changed / selection-changed events to
// the caller.
//
// Comment highlighting (ADR-0064 §2a, editor comment UI slice): `comments`
// feeds the pure `resolvableCommentRanges` (comment-decorations.ts), and the
// result is pushed into the mounted view's decoration plugin via
// `tr.setMeta(commentHighlightsKey, ranges)` whenever the `comments` prop
// changes (a fetcher revalidation after add/reply/resolve). Ordinary typing
// transactions carry no such meta — the plugin re-maps existing decorations
// through ProseMirror's own position mapping instead (best-effort: an edit
// that invalidates a range just stops highlighting it, ADR-0064 §2a).
import type { PMDocJson } from "arp-report-html";
import { EditorView } from "prosemirror-view";
import { useEffect, useRef } from "react";
import type { CommentForHighlight } from "../editor/comment-decorations";
import { commentHighlightsKey, resolvableCommentRanges } from "../editor/comment-decorations";
import { createEditorState, docJson } from "../editor/editor-state";

/** The editor's current text selection, forwarded to the caller so it can
 *  build an ADR-0064 anchor when the user clicks "Comment" (`from === to`
 *  means an empty/collapsed selection, reported as `null`). */
export interface EditorSelection {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export interface ReportEditorProps {
  /** The document to open — the lossless `_source.json` sidecar, or a
   *  best-effort HTML→PM parse when none exists yet (ADR-0062 §4). Read only
   *  at mount: the editor owns its own state thereafter. */
  readonly initialDoc: PMDocJson;
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
  readonly className?: string;
}

function selectionInfo(view: EditorView): EditorSelection | null {
  const { from, to } = view.state.selection;
  if (from === to) return null;
  return { from, to, text: view.state.doc.textBetween(from, to, " ") };
}

export function ReportEditor({
  initialDoc,
  onChange,
  onSelectionChange,
  comments,
  className,
}: ReportEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  // biome-ignore lint/correctness/useExhaustiveDependencies: initialDoc is read only at mount by design (see the prop doc-comment) — the parent remounts via a `key` change (e.g. the slug) to load a genuinely different document.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView(host, {
      state: createEditorState(initialDoc),
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) onChangeRef.current(docJson(next));
        onSelectionChangeRef.current?.(selectionInfo(view));
      },
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = undefined;
    };
  }, []);

  // Re-seed the comment highlight decorations whenever the comments list
  // changes (new comment added, or the sidebar's revalidated list arrives).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const ranges = resolvableCommentRanges(view.state.doc.content.size, comments ?? []);
    view.dispatch(view.state.tr.setMeta(commentHighlightsKey, ranges));
  }, [comments]);

  return <div ref={hostRef} className={className} />;
}
