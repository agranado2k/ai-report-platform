// Behavior tests for commentToDto — the shared Comment→client mapping used by
// BOTH the reports.$slug.edit loader (the sidebar's initial list) and the
// reports.$slug.comments action's success response (so a fresh comment/reply/
// resolve reflects immediately without waiting for loader revalidation).
import { commentId, reportId, userId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { commentToDto } from "./comment-dto.server";

const baseComment = {
  id: commentId("11111111-1111-7111-8111-111111111111"),
  reportId: reportId("22222222-2222-7222-8222-222222222222"),
  authorUserId: userId("33333333-3333-7333-8333-333333333333"),
  body: "a note",
  anchor: {
    versionPinned: {
      versionId: versionId("44444444-4444-7444-8444-444444444444"),
      textQuote: "quoted text",
    },
  },
  parentCommentId: null,
  resolvedAt: null,
  createdAt: 1_700_000_000_000,
};

describe("commentToDto", () => {
  it("wire-encodes the comment id and version id (ADR-0052 External Ids)", () => {
    const dto = commentToDto(baseComment);
    expect(dto.id.startsWith("comment_")).toBe(true);
    expect(dto.anchor.versionId.startsWith("version_")).toBe(true);
  });

  it("carries a null parentId for a root comment", () => {
    const dto = commentToDto(baseComment);
    expect(dto.parentId).toBeNull();
  });

  it("wire-encodes a non-null parentCommentId for a reply", () => {
    const reply = {
      ...baseComment,
      parentCommentId: commentId("55555555-5555-7555-8555-555555555555"),
    };
    const dto = commentToDto(reply);
    expect(dto.parentId?.startsWith("comment_")).toBe(true);
  });

  it("renders resolvedAt/createdAt as ISO strings, and null resolvedAt when unresolved", () => {
    const dto = commentToDto(baseComment);
    expect(dto.resolvedAt).toBeNull();
    expect(dto.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("renders a non-null resolvedAt as an ISO string once resolved", () => {
    const resolved = { ...baseComment, resolvedAt: 1_700_000_100_000 };
    const dto = commentToDto(resolved);
    expect(dto.resolvedAt).toBe(new Date(1_700_000_100_000).toISOString());
  });

  it("omits relative from the DTO's anchor when the domain anchor carries none", () => {
    const dto = commentToDto(baseComment);
    expect("relative" in dto.anchor).toBe(false);
  });

  it("passes the anchor's opaque relative slot through unchanged when present", () => {
    const withRelative = {
      ...baseComment,
      anchor: { ...baseComment.anchor, relative: { from: 1, to: 5 } },
    };
    const dto = commentToDto(withRelative);
    expect(dto.anchor.relative).toEqual({ from: 1, to: 5 });
  });

  it("defaults authorEmail to null, and threads an explicit value through when given", () => {
    expect(commentToDto(baseComment).authorEmail).toBeNull();
    expect(commentToDto(baseComment, "author@example.com").authorEmail).toBe("author@example.com");
  });
});
