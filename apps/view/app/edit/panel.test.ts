import { describe, expect, it } from "vitest";
import {
  closePanel,
  INITIAL_PANEL_STATE,
  openPanel,
  selectPanelTab,
  unresolvedCount,
} from "./panel";
import type { CommentWire } from "./wire-types";

function comment(overrides: Partial<CommentWire> = {}): CommentWire {
  return {
    object: "comment",
    id: "comment_1",
    report_id: "report_1",
    author_id: "user_1",
    parent_id: null,
    body: "hi",
    intent: "note",
    anchor: { version_pinned: { version_id: "version_1", text_quote: "q" } },
    resolved_at: null,
    created_at: "2026-07-08T00:00:00.000Z",
    mode: "prod",
    ...overrides,
  };
}

describe("unresolvedCount", () => {
  it("is 0 for no comments", () => {
    expect(unresolvedCount([])).toBe(0);
  });

  it("counts only unresolved root comments", () => {
    const comments = [
      comment({ id: "a" }), // active root → counts
      comment({ id: "b", resolved_at: "2026-07-09T00:00:00.000Z" }), // resolved → skip
      comment({ id: "c", parent_id: "a" }), // reply → skip
      comment({ id: "d" }), // active root → counts
    ];
    expect(unresolvedCount(comments)).toBe(2);
  });

  it("does not count an unresolved reply on an active thread", () => {
    const comments = [comment({ id: "root" }), comment({ id: "reply", parent_id: "root" })];
    expect(unresolvedCount(comments)).toBe(1);
  });
});

describe("panel state", () => {
  it("starts closed on the comments tab", () => {
    expect(INITIAL_PANEL_STATE).toEqual({ open: false, tab: "comments" });
  });

  it("opens to the requested tab (closed → open)", () => {
    expect(openPanel("comments")).toEqual({ open: true, tab: "comments" });
    expect(openPanel("versions")).toEqual({ open: true, tab: "versions" });
  });

  it("switches the tab while open", () => {
    const open = openPanel("comments");
    expect(selectPanelTab(open, "versions")).toEqual({ open: true, tab: "versions" });
  });

  it("remembers the tab across close and reopen", () => {
    const onVersions = selectPanelTab(openPanel("versions"), "versions");
    const closed = closePanel(onVersions);
    expect(closed).toEqual({ open: false, tab: "versions" });
  });
});
