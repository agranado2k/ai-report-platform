// The harness page's app: the REAL `ReportEditor`, mounted the way
// apps/view's `/edit` route mounts it (same props, same surrounding
// full-height / overflow-hidden pane layout), over a report parsed by the
// REAL `parseBody`. Nothing about link activation, comment highlighting, the
// anchor scroll or the Selection toolbar is stubbed — that is the entire
// point of this tier.
import {
  type ActiveFormats,
  type CommentForHighlight,
  type CommentRange,
  type EditorSelection,
  ReportEditor,
  type ReportEditorHandle,
  type SelectionGeometry,
} from "arp-editor";
import { type PMDocJson, parseBody, splitShell } from "arp-report-html";
import * as React from "react";
import { createRoot } from "react-dom/client";
// Resolved against apps/view (the harness bundles with `resolveDir` there —
// build.mts), so this is the REAL route component, not a copy.
import { SelectionToolbar } from "./app/edit/components/SelectionToolbar";

const raw = (document.getElementById("report-src") as HTMLScriptElement).textContent ?? "";
const { shell, bodyHtml } = splitShell(raw);
const doc: PMDocJson = parseBody(bodyHtml);

function App() {
  // Mirrors the route's own state wiring, so the React re-render churn a real
  // click produces is present here too.
  const [selection, setSelection] = React.useState<EditorSelection | null>(null);
  // The Selection toolbar's driver (ticket #296) — same contract as the
  // route: null mid-drag / on Escape / on document scroll means no toolbar.
  const [selectionGeometry, setSelectionGeometry] = React.useState<SelectionGeometry | null>(null);
  // The toolbar's live active state (ticket #297) — same contract as the
  // route: reported alongside the geometry on every transaction.
  const [selectionFormats, setSelectionFormats] = React.useState<ActiveFormats | null>(null);
  const [, setRanges] = React.useState<readonly CommentRange[]>([]);
  const [focused, setFocused] = React.useState<string | null>(null);
  // Comments are STATE, not a frozen empty array: click-to-highlight shares
  // the exact `handleDOMEvents.click` handler that link activation runs
  // through (`editorClickOutcome` decides between them), so a fixture with no
  // comments leaves half of that handler's dispatch matrix unexercised in the
  // one tier that can see a real click.
  const [comments, setComments] = React.useState<readonly CommentForHighlight[]>([]);
  const editorRef = React.useRef<ReportEditorHandle>(null);

  return (
    <div className="root-layout">
      <header className="topbar">
        {/* The route turns the pending selection into a comment through the
            panel composer; the harness does the same thing with one button, so
            a browser test can create a highlight from a real mouse selection
            rather than hand-computing ProseMirror positions. */}
        <button
          type="button"
          data-testid="add-comment"
          disabled={selection === null}
          onClick={() => {
            if (!selection) return;
            setComments((prev) => [
              ...prev,
              {
                id: `comment-${prev.length + 1}`,
                anchor: { relative: { from: selection.from, to: selection.to } },
                intent: "note",
              },
            ]);
          }}
        >
          Comment
        </button>
        {/* The panel's "Jump" — a PROGRAMMATIC selection reveal. The one way
            the Selection toolbar contract "a programmatic selection never
            shows the toolbar" can be driven from a real page. */}
        <button
          type="button"
          data-testid="jump-to-comment"
          disabled={comments.length === 0}
          onClick={() => {
            const first = comments[0];
            if (first) editorRef.current?.jumpToComment(first);
          }}
        >
          Jump
        </button>
        <span data-testid="focused-comment">{focused ?? ""}</span>
        <span data-testid="pending-selection">{selection?.text ?? ""}</span>
      </header>
      <div className="pane-row">
        <main className="doc-pane">
          <div className="editor-slot">
            <ReportEditor
              ref={editorRef}
              initialDoc={doc}
              shell={shell}
              comments={comments}
              onChange={() => {}}
              // A CALLER CALLBACK THAT CAN BE ARMED TO THROW.
              //
              // `onSelectionChange` is called from inside `view.dispatch(...)`
              // — i.e. from inside the editor's own `handleDOMEvents.click`
              // handler — and prosemirror-view 1.42.0 wraps a custom DOM
              // handler in NO try/catch (`runCustomHandler`, dist/index.js:
              // 3145). So a caller whose callback throws aborts the rest of
              // the click handler, after ProseMirror has already applied the
              // caret and issued its own reveal. That is the one shape the
              // browser tier can drive that reproduces the production trace
              // exactly, and the anchor jump must survive it.
              //
              // Armed from the test rather than always-on: every other
              // contract in this suite needs the normal, non-throwing wiring.
              onSelectionChange={(next, geometry, formats) => {
                if (
                  (window as unknown as { __throwOnSelectionChange?: boolean })
                    .__throwOnSelectionChange
                ) {
                  throw new Error("the caller's onSelectionChange threw");
                }
                setSelection(next);
                setSelectionGeometry(geometry);
                setSelectionFormats(formats);
              }}
              onEscape={() => setSelectionGeometry(null)}
              onDocScroll={() => setSelectionGeometry(null)}
              onCommentRangesChange={setRanges}
              onCommentClick={setFocused}
              className="editor-iframe"
            />
            {selectionGeometry && selectionFormats ? (
              <SelectionToolbar
                geometry={selectionGeometry}
                formats={selectionFormats}
                onToggleFormat={(format) => editorRef.current?.toggleFormat(format)}
                onApplyLink={(href) => editorRef.current?.applyLink(href) ?? false}
                onRemoveLink={() => editorRef.current?.removeLink() ?? false}
              />
            ) : null}
          </div>
        </main>
        <aside className="side-panel">panel</aside>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
