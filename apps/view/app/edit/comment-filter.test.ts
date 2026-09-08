import { describe, expect, it } from "vitest";
import {
  countRootsByStatus,
  isResolved,
  type ThreadFilter,
  threadVisibleUnderFilter,
} from "./comment-filter";
import type { CommentWire } from "./wire-types";

function comment(overrides: Partial<CommentWire> = {}): CommentWire {
  const base: CommentWire = {
    object: "comment",
    id: "comment_1",
    report_id: "report_1",
    author_id: "user_1",
    author: { id: "user_1", email: null, name: null },
    parent_id: null,
    body: "hi",
    intent: "note",
    anchor: { version_pinned: { version_id: "version_1", text_quote: "q" } },
    edited_at: null,
    resolved_at: null,
    created_at: "2026-07-08T00:00:00.000Z",
    mode: "prod",
  };
  return { ...base, ...overrides };
}

const RESOLVED_AT = "2026-07-09T00:00:00.000Z";

describe("isResolved", () => {
  it("is true only when resolved_at carries a timestamp", () => {
    expect(isResolved(comment())).toBe(false);
    expect(isResolved(comment({ resolved_at: RESOLVED_AT }))).toBe(true);
  });
});

describe("countRootsByStatus", () => {
  it("is 0/0 for no comments", () => {
    expect(countRootsByStatus([])).toEqual({ open: 0, resolved: 0 });
  });

  it("counts root threads by status, never replies", () => {
    const comments = [
      comment({ id: "a" }), // open root → open
      comment({ id: "b", resolved_at: RESOLVED_AT }), // resolved root → resolved
      comment({ id: "c", parent_id: "a" }), // reply → neither
      comment({ id: "d", parent_id: "b", resolved_at: RESOLVED_AT }), // resolved reply → neither
      comment({ id: "e" }), // open root → open
    ];
    expect(countRootsByStatus(comments)).toEqual({ open: 2, resolved: 1 });
  });
});

describe("threadVisibleUnderFilter", () => {
  const open = comment({ id: "open", resolved_at: null });
  const resolved = comment({ id: "resolved", resolved_at: RESOLVED_AT });

  it("shows only open threads under the Open filter", () => {
    expect(threadVisibleUnderFilter(open, "open", null)).toBe(true);
    expect(threadVisibleUnderFilter(resolved, "open", null)).toBe(false);
  });

  it("shows only resolved threads under the Resolved filter", () => {
    expect(threadVisibleUnderFilter(open, "resolved", null)).toBe(false);
    expect(threadVisibleUnderFilter(resolved, "resolved", null)).toBe(true);
  });

  it("always shows the FOCUSED thread, even against the filter", () => {
    // A resolved thread clicked from its highlight (item B) must not be hidden
    // by the default Open filter.
    expect(threadVisibleUnderFilter(resolved, "open", "resolved")).toBe(true);
    // …and an open thread stays visible when focused under the Resolved filter.
    expect(threadVisibleUnderFilter(open, "resolved", "open")).toBe(true);
  });

  it("does not let a non-matching focus id rescue an off-filter thread", () => {
    const filter: ThreadFilter = "open";
    expect(threadVisibleUnderFilter(resolved, filter, "someone-else")).toBe(false);
  });
});
