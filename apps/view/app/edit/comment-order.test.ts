// Document-order sorting + degraded-anchor classification for the Comments
// panel (comment-UX adoptions, items C and D). Pure — apps/view has no
// component-DOM test tier (vitest `environment: "node"`), so the panel's
// ordering/badging decisions are extracted here and tested directly, same
// pattern as ../edit/panel.ts and ../edit/comment-format.ts.
import { describe, expect, it } from "vitest";
import { orderRootComments, versionNoForPin } from "./comment-order";
import type { CommentWire, VersionWire } from "./wire-types";

function makeComment(overrides: Partial<CommentWire> & { id: string }): CommentWire {
  return {
    object: "comment",
    report_id: "report_1",
    author_id: "user_1",
    author: { id: "user_1", email: null, name: null },
    parent_id: null,
    body: "hi",
    intent: "note",
    anchor: { version_pinned: { version_id: "version_1", text_quote: "q" } },
    edited_at: null,
    resolved_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    mode: "prod",
    ...overrides,
  };
}

describe("orderRootComments", () => {
  it("orders roots by their resolved anchor position, not created_at", () => {
    const late = makeComment({
      id: "late-but-early-in-doc",
      created_at: "2026-07-20T00:00:00.000Z",
    });
    const early = makeComment({
      id: "early-but-late-in-doc",
      created_at: "2026-07-01T00:00:00.000Z",
    });
    const ordered = orderRootComments(
      [early, late],
      [
        { commentId: "late-but-early-in-doc", from: 2 },
        { commentId: "early-but-late-in-doc", from: 90 },
      ],
    );
    expect(ordered.map((o) => o.comment.id)).toEqual([
      "late-but-early-in-doc",
      "early-but-late-in-doc",
    ]);
    expect(ordered.map((o) => o.position)).toEqual([2, 90]);
  });

  it("falls back to the raw relative.from for a comment with no resolved range", () => {
    const resolvedAt5 = makeComment({ id: "resolved-at-5" });
    const rawAt3 = makeComment({
      id: "raw-at-3",
      anchor: {
        version_pinned: { version_id: "version_1", text_quote: "q" },
        relative: { from: 3, to: 8 },
      },
    });
    const ordered = orderRootComments(
      [resolvedAt5, rawAt3],
      [{ commentId: "resolved-at-5", from: 5 }],
    );
    expect(ordered.map((o) => o.comment.id)).toEqual(["raw-at-3", "resolved-at-5"]);
  });

  it("falls back to created_at order for comments with no position at all", () => {
    const older = makeComment({ id: "older", created_at: "2026-07-01T00:00:00.000Z" });
    const newer = makeComment({ id: "newer", created_at: "2026-07-02T00:00:00.000Z" });
    const ordered = orderRootComments([newer, older], []);
    expect(ordered.map((o) => o.comment.id)).toEqual(["older", "newer"]);
  });

  it("places position-less comments after positioned ones", () => {
    const positioned = makeComment({ id: "positioned" });
    const positionless = makeComment({
      id: "positionless",
      created_at: "2026-06-01T00:00:00.000Z", // older — still sorts after
    });
    const ordered = orderRootComments(
      [positionless, positioned],
      [{ commentId: "positioned", from: 40 }],
    );
    expect(ordered.map((o) => o.comment.id)).toEqual(["positioned", "positionless"]);
  });

  it("excludes replies — only roots are ordered", () => {
    const root = makeComment({ id: "root" });
    const reply = makeComment({ id: "reply", parent_id: "root" });
    const ordered = orderRootComments([root, reply], []);
    expect(ordered.map((o) => o.comment.id)).toEqual(["root"]);
  });

  it("flags an UNRESOLVED root with no resolved range as degraded (item D)", () => {
    const degraded = makeComment({
      id: "degraded",
      anchor: {
        version_pinned: { version_id: "version_1", text_quote: "q" },
        relative: { from: 500, to: 900 }, // was valid once; no longer resolves
      },
    });
    const live = makeComment({ id: "live" });
    const ordered = orderRootComments([degraded, live], [{ commentId: "live", from: 4 }]);
    const byId = new Map(ordered.map((o) => [o.comment.id, o]));
    expect(byId.get("degraded")?.degraded).toBe(true);
    expect(byId.get("live")?.degraded).toBe(false);
  });

  it("never flags a RESOLVED thread as degraded (resolved threads aren't highlighted)", () => {
    const resolvedThread = makeComment({
      id: "done",
      resolved_at: "2026-07-10T00:00:00.000Z",
    });
    const ordered = orderRootComments([resolvedThread], []);
    expect(ordered[0]?.degraded).toBe(false);
  });
});

describe("versionNoForPin", () => {
  const versions: readonly VersionWire[] = [
    {
      object: "version",
      id: "version_1",
      version_no: 1,
      uploaded_by: "user_1",
      author: { id: "user_1", email: null, name: null },
      uploaded_at: "2026-07-01T00:00:00.000Z",
      scan_status: "clean",
      size_bytes: 10,
      origin: "upload",
      mode: "prod",
    },
    {
      object: "version",
      id: "version_2",
      version_no: 2,
      uploaded_by: "user_1",
      author: { id: "user_1", email: null, name: null },
      uploaded_at: "2026-07-02T00:00:00.000Z",
      scan_status: "clean",
      size_bytes: 12,
      origin: "editor",
      mode: "prod",
    },
  ];

  it("maps a pinned version id to its version number", () => {
    expect(versionNoForPin(versions, "version_2")).toBe(2);
  });

  it("returns null for a version id not in the list", () => {
    expect(versionNoForPin(versions, "version_999")).toBeNull();
  });
});
