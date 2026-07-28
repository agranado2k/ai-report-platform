import { describe, expect, it } from "vitest";
import type { Anchor } from "./anchor";
import { commentId, reportId, userId, versionId } from "./brand";
import {
  type Comment,
  createComment,
  editComment,
  replyToComment,
  resolveComment,
} from "./comment";

const report = reportId("00000000-0000-7000-8000-0000000000a1");
const version = versionId("00000000-0000-7000-8000-0000000000b1");
const author = userId("00000000-0000-7000-8000-0000000000c1");
const replier = userId("00000000-0000-7000-8000-0000000000c2");
const rootId = commentId("00000000-0000-7000-8000-0000000000d1");
const replyId = commentId("00000000-0000-7000-8000-0000000000d2");

const anchor: Anchor = { versionPinned: { versionId: version, textQuote: "the Q3 number" } };

describe("createComment", () => {
  it("creates a root comment and emits CommentAdded", () => {
    const r = createComment({
      id: rootId,
      reportId: report,
      authorUserId: author,
      body: "What does this mean?",
      anchor,
      createdAt: 1000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.comment).toMatchObject({
      id: rootId,
      reportId: report,
      authorUserId: author,
      body: "What does this mean?",
      parentCommentId: null,
      resolvedAt: null,
      createdAt: 1000,
    });
    expect(r.value.events).toEqual([
      {
        type: "CommentAdded",
        commentId: rootId,
        reportId: report,
        authorUserId: author,
        parentCommentId: null,
      },
    ]);
  });

  it("trims the body and rejects an empty one", () => {
    const empty = createComment({
      id: rootId,
      reportId: report,
      authorUserId: author,
      body: "   ",
      anchor,
      createdAt: 1,
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.kind).toBe("ValidationError");

    const trimmed = createComment({
      id: rootId,
      reportId: report,
      authorUserId: author,
      body: "  hi  ",
      anchor,
      createdAt: 1,
    });
    expect(trimmed.ok && trimmed.value.comment.body).toBe("hi");
  });

  it("rejects a body over the bounded length", () => {
    const r = createComment({
      id: rootId,
      reportId: report,
      authorUserId: author,
      body: "x".repeat(2001),
      anchor,
      createdAt: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });

  it("rejects an anchor with an empty text quote", () => {
    const bad: Anchor = { versionPinned: { versionId: version, textQuote: "" } };
    const r = createComment({
      id: rootId,
      reportId: report,
      authorUserId: author,
      body: "hi",
      anchor: bad,
      createdAt: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });

  it("defaults intent to note when absent, and carries a supplied intent", () => {
    const def = createComment({
      id: rootId,
      reportId: report,
      authorUserId: author,
      body: "hi",
      anchor,
      createdAt: 1,
    });
    expect(def.ok && def.value.comment.intent).toBe("note");

    const enhance = createComment({
      id: rootId,
      reportId: report,
      authorUserId: author,
      body: "hi",
      anchor,
      intent: "enhancement",
      createdAt: 1,
    });
    expect(enhance.ok && enhance.value.comment.intent).toBe("enhancement");
  });

  it("accepts an anchor carrying an opaque `relative` payload", () => {
    const withRelative: Anchor = { ...anchor, relative: { pos: 42, type: "yjs-relative" } };
    const r = createComment({
      id: rootId,
      reportId: report,
      authorUserId: author,
      body: "hi",
      anchor: withRelative,
      createdAt: 1,
    });
    expect(r.ok && r.value.comment.anchor.relative).toEqual({ pos: 42, type: "yjs-relative" });
  });
});

describe("replyToComment", () => {
  function rootComment(): Comment {
    const r = createComment({
      id: rootId,
      reportId: report,
      authorUserId: author,
      body: "root",
      anchor,
      createdAt: 1000,
    });
    if (!r.ok) throw new Error("fixture failed");
    return r.value.comment;
  }

  it("replies to a root comment, carrying the parent's reportId", () => {
    const root = rootComment();
    const r = replyToComment(root, {
      id: replyId,
      authorUserId: replier,
      body: "Because of the Q3 restatement.",
      anchor,
      createdAt: 2000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.comment).toMatchObject({
      id: replyId,
      reportId: report,
      authorUserId: replier,
      parentCommentId: rootId,
    });
    expect(r.value.events).toEqual([
      {
        type: "CommentAdded",
        commentId: replyId,
        reportId: report,
        authorUserId: replier,
        parentCommentId: rootId,
      },
    ]);
  });

  it("rejects replying to a reply (single-level threading)", () => {
    const root = rootComment();
    const firstReply = replyToComment(root, {
      id: replyId,
      authorUserId: replier,
      body: "a reply",
      anchor,
      createdAt: 2000,
    });
    if (!firstReply.ok) throw new Error("fixture failed");

    const secondReply = replyToComment(firstReply.value.comment, {
      id: commentId("00000000-0000-7000-8000-0000000000d3"),
      authorUserId: author,
      body: "a reply to a reply",
      anchor,
      createdAt: 3000,
    });
    expect(secondReply.ok).toBe(false);
    if (!secondReply.ok) expect(secondReply.error.kind).toBe("ValidationError");
  });

  it("defaults a reply's intent to note, and carries a supplied one", () => {
    const root = rootComment();
    const def = replyToComment(root, {
      id: replyId,
      authorUserId: replier,
      body: "a reply",
      anchor,
      createdAt: 2000,
    });
    expect(def.ok && def.value.comment.intent).toBe("note");

    const add = replyToComment(root, {
      id: replyId,
      authorUserId: replier,
      body: "a reply",
      anchor,
      intent: "add",
      createdAt: 2000,
    });
    expect(add.ok && add.value.comment.intent).toBe("add");
  });

  it("validates the reply body and anchor same as createComment", () => {
    const root = rootComment();
    const r = replyToComment(root, {
      id: replyId,
      authorUserId: replier,
      body: "   ",
      anchor,
      createdAt: 2000,
    });
    expect(r.ok).toBe(false);
  });
});

describe("resolveComment", () => {
  function rootComment(): Comment {
    const r = createComment({
      id: rootId,
      reportId: report,
      authorUserId: author,
      body: "root",
      anchor,
      createdAt: 1000,
    });
    if (!r.ok) throw new Error("fixture failed");
    return r.value.comment;
  }

  it("resolves an open comment and emits CommentResolved", () => {
    const root = rootComment();
    const r = resolveComment(root, 5000);
    expect(r.comment.resolvedAt).toBe(5000);
    expect(r.events).toEqual([
      { type: "CommentResolved", commentId: rootId, reportId: report, resolvedAt: 5000 },
    ]);
  });

  it("is idempotent — resolving an already-resolved comment is a no-op", () => {
    const root = rootComment();
    const once = resolveComment(root, 5000);
    const twice = resolveComment(once.comment, 9999);
    expect(twice.comment.resolvedAt).toBe(5000); // unchanged
    expect(twice.events).toEqual([]); // no duplicate event
  });
});

describe("editComment", () => {
  function rootComment(): Comment {
    const r = createComment({
      id: rootId,
      reportId: report,
      authorUserId: author,
      body: "original body",
      anchor,
      intent: "note",
      createdAt: 1000,
    });
    if (!r.ok) throw new Error("fixture failed");
    return r.value.comment;
  }

  it("replaces the body, emitting CommentEdited", () => {
    const r = editComment(rootComment(), { body: "edited body", editedAt: 5000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.comment.body).toBe("edited body");
    expect(r.value.comment.intent).toBe("note"); // unchanged
    expect(r.value.events).toEqual([
      { type: "CommentEdited", commentId: rootId, reportId: report, editedAt: 5000 },
    ]);
  });

  it("replaces the intent while leaving the body unchanged", () => {
    const r = editComment(rootComment(), { intent: "enhancement", editedAt: 5000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.comment.intent).toBe("enhancement");
    expect(r.value.comment.body).toBe("original body"); // unchanged
  });

  it("replaces both body and intent together", () => {
    const r = editComment(rootComment(), { body: "new", intent: "add", editedAt: 5000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.comment.body).toBe("new");
    expect(r.value.comment.intent).toBe("add");
  });

  it("trims and re-validates the body — an empty/whitespace body is rejected", () => {
    const r = editComment(rootComment(), { body: "   ", editedAt: 5000 });
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("rejects an edit that provides neither body nor intent", () => {
    const r = editComment(rootComment(), { editedAt: 5000 });
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("leaves the anchor and resolved state immutable", () => {
    const resolved = resolveComment(rootComment(), 2000).comment;
    const r = editComment(resolved, { body: "edited", editedAt: 5000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.comment.anchor).toEqual(anchor);
    expect(r.value.comment.resolvedAt).toBe(2000); // unchanged by an edit
  });
});
