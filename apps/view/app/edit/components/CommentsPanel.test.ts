// authorLabel (ADR-0063 author display): prefer the display name, else the
// resolved email, else a stable label — never the raw user_… id.
// Plus the panel's post-#298 composer contract: the Floating composer is the
// SOLE creation path for selection-anchored root comments, so the panel never
// renders a new-comment composer (the retired pendingSelection auto-open).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CommentWire } from "../wire-types";
import { authorLabel, CommentsPanel } from "./CommentsPanel";

const base: CommentWire = {
  object: "comment",
  id: "comment_1",
  report_id: "report_1",
  author_id: "user_5mK9pQ2vR4nXtB6cD8eF1g",
  author: { id: "user_5mK9pQ2vR4nXtB6cD8eF1g", email: null, name: null },
  parent_id: null,
  body: "hi",
  intent: "note",
  anchor: { version_pinned: { version_id: "version_1", text_quote: "q" } },
  edited_at: null,
  resolved_at: null,
  created_at: "2026-07-08T00:00:00.000Z",
  mode: "prod",
};

describe("authorLabel", () => {
  it("prefers the display name when present", () => {
    expect(
      authorLabel({
        ...base,
        author: { id: base.author_id, email: "alice@example.com", name: "Alice Ackerman" },
      }),
    ).toBe("Alice Ackerman");
  });

  it("shows the author's email when no display name is present", () => {
    expect(
      authorLabel({
        ...base,
        author: { id: base.author_id, email: "alice@example.com", name: null },
      }),
    ).toBe("alice@example.com");
  });

  it("falls back to 'Unknown user' when neither name nor email resolves (never the raw id)", () => {
    // The wire ALWAYS carries `author` (resource.ts null-fills it — see the
    // arp-http/wire catalog); a deleted/never-mirrored user arrives as
    // { email: null, name: null }, which `base` models.
    const label = authorLabel(base);
    expect(label).toBe("Unknown user");
    expect(label).not.toContain("user_");
  });
});

describe("CommentsPanel presentation (T8, §06)", () => {
  const openNote: CommentWire = {
    ...base,
    id: "comment_open",
    intent: "note",
    body: "still open",
    anchor: { version_pinned: { version_id: "version_1", text_quote: "the quoted passage" } },
  };
  const resolvedEnhancement: CommentWire = {
    ...base,
    id: "comment_resolved",
    intent: "enhancement",
    body: "already handled",
    resolved_at: "2026-07-09T00:00:00.000Z",
  };

  function render(comments: readonly CommentWire[]): string {
    return renderToStaticMarkup(
      createElement(CommentsPanel, {
        appOrigin: "https://app.example",
        slug: "report-1",
        editToken: "et",
        comments,
        onCommentsChange: () => {},
        commentRanges: [],
        versions: [],
      }),
    );
  }

  it("renders an Open/Resolved filter with per-status counts", () => {
    const html = render([openNote, resolvedEnhancement]);
    expect(html).toContain("Filter threads");
    expect(html).toContain("Open");
    expect(html).toContain("Resolved");
  });

  it("shows every intent as a scannable pill — note included (§06)", () => {
    // The earlier design hid the `note` pill; §06 wants the intent always
    // legible so a thread reads as a thread.
    const html = render([openNote]);
    expect(html).toContain("Note");
  });

  it("renders the quoted selection as a <blockquote>", () => {
    const html = render([openNote]);
    expect(html).toContain("<blockquote");
    expect(html).toContain("the quoted passage");
  });

  it("defaults to Open: an open thread shows, a resolved one is hidden", () => {
    const html = render([openNote, resolvedEnhancement]);
    expect(html).toContain("still open");
    expect(html).not.toContain("already handled");
  });

  it("shows the focused thread even when it is off-filter (item B)", () => {
    // A resolved thread clicked from its highlight must not be hidden by the
    // default Open filter.
    const html = renderToStaticMarkup(
      createElement(CommentsPanel, {
        appOrigin: "https://app.example",
        slug: "report-1",
        editToken: "et",
        comments: [openNote, resolvedEnhancement],
        onCommentsChange: () => {},
        commentRanges: [],
        versions: [],
        focusedCommentId: "comment_resolved",
      }),
    );
    expect(html).toContain("already handled");
  });
});

describe("CommentsPanel composer contract (ticket #298)", () => {
  it("never renders a new-comment composer — it points at the Selection toolbar instead", () => {
    // The pendingSelection-driven auto-open is RETIRED: the panel takes no
    // selection at all any more, and the Floating composer (opened from the
    // toolbar's "…" bubble) is the one creation path for selection-anchored
    // root comments. The panel's read-side hint names that path.
    const html = renderToStaticMarkup(
      createElement(CommentsPanel, {
        appOrigin: "https://app.example",
        slug: "report-1",
        editToken: "et",
        comments: [],
        onCommentsChange: () => {},
        commentRanges: [],
        versions: [],
      }),
    );
    expect(html).not.toContain("Add a comment…");
    expect(html).toContain("Select text in the document");
    expect(html).toContain("“…”");
  });
});
