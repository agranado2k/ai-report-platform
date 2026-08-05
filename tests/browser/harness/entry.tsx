// The harness page's app: the REAL `ReportEditor`, mounted the way
// apps/view's `/edit` route mounts it (same props, same surrounding
// full-height / overflow-hidden pane layout), over a report parsed by the
// REAL `parseBody`. Nothing about link activation or the anchor scroll is
// stubbed — that is the entire point of this tier.
import { type CommentRange, ReportEditor } from "arp-editor";
import { type PMDocJson, parseBody, splitShell } from "arp-report-html";
import * as React from "react";
import { createRoot } from "react-dom/client";

const raw = (document.getElementById("report-src") as HTMLScriptElement).textContent ?? "";
const { shell, bodyHtml } = splitShell(raw);
const doc: PMDocJson = parseBody(bodyHtml);

function App() {
  // Mirrors the route's own state wiring, so the React re-render churn a real
  // click produces is present here too.
  const [selection, setSelection] = React.useState<unknown>(null);
  const [, setRanges] = React.useState<readonly CommentRange[]>([]);
  const [focused, setFocused] = React.useState<string | null>(null);
  const comments = React.useMemo(() => [], []);
  return (
    <div className="root-layout">
      <header className="topbar">
        Editor {focused ?? ""} {selection ? "sel" : ""}
      </header>
      <div className="pane-row">
        <main className="doc-pane">
          <div className="editor-slot">
            <ReportEditor
              initialDoc={doc}
              shell={shell}
              comments={comments}
              onChange={() => {}}
              onSelectionChange={setSelection}
              onCommentRangesChange={setRanges}
              onCommentClick={setFocused}
              className="editor-iframe"
            />
          </div>
        </main>
        <aside className="side-panel">panel</aside>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
