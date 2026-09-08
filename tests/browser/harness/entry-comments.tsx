// A minimal harness app that mounts the REAL `CommentsPanel` (resolved against
// apps/view — build.mts bundles with `resolveDir` there) so the browser tier can
// drive the T8 Open/Resolved filter with real clicks (ADR-0079). apps/view has
// no jsdom/component tier, so interactive filter state can only be exercised
// here; the filter's DECISION logic is separately unit-tested (comment-filter.ts).
//
// No editor, no iframe, no network: the panel's reads (author, time, quoted
// selection, intent pill, filter) are all client-side over the injected fixture
// comments. The panel's mutations (resolve/reply/edit) do cross-origin fetch,
// which these state contracts never trigger — they only read and filter.
import * as React from "react";
import { createRoot } from "react-dom/client";
import { CommentsPanel } from "./app/edit/components/CommentsPanel";
import type { CommentWire } from "./app/edit/wire-types";

function comment(overrides: Partial<CommentWire>): CommentWire {
  const base: CommentWire = {
    object: "comment",
    id: "comment_1",
    report_id: "report_1",
    author_id: "user_1",
    author: { id: "user_1", email: null, name: "Marta Kowalski" },
    parent_id: null,
    body: "body",
    intent: "note",
    anchor: { version_pinned: { version_id: "version_1", text_quote: "the quoted passage" } },
    edited_at: null,
    resolved_at: null,
    created_at: "2026-07-08T00:00:00.000Z",
    mode: "prod",
  };
  return { ...base, ...overrides };
}

const FIXTURES: readonly CommentWire[] = [
  comment({
    id: "open-enh",
    intent: "enhancement",
    body: "can we split these",
    author: { id: "u1", email: null, name: "Marta Kowalski" },
  }),
  comment({
    id: "resolved-note",
    intent: "note",
    body: "add the sample size",
    resolved_at: "2026-07-09T00:00:00.000Z",
    author: { id: "u2", email: null, name: "Jo Sato" },
  }),
];

function App() {
  const [comments, setComments] = React.useState<readonly CommentWire[]>(FIXTURES);
  return (
    <div className="side-panel" data-testid="comments-harness">
      <CommentsPanel
        appOrigin="https://app.example"
        slug="report-1"
        editToken="et"
        comments={comments}
        onCommentsChange={setComments}
        commentRanges={[]}
        versions={[]}
      />
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
