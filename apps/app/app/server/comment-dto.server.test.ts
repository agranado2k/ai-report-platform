// Behavior tests for the comment author-id dedupe (ADR-0063 author display).
// Mirrors version-dto.server.test.ts's `uniqueVersionAuthorIds` coverage.
import type { Comment } from "arp-domain";
import { commentId, reportId, userId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import { uniqueCommentAuthorIds } from "./comment-dto.server";

const authorA = userId("11111111-1111-7111-8111-111111111111");
const authorB = userId("22222222-2222-7222-8222-222222222222");

function comment(id: string, author = authorA): Comment {
  return {
    id: commentId(id),
    reportId: reportId("33333333-3333-7333-8333-333333333333"),
    authorUserId: author,
    body: "hi",
    anchor: {
      versionPinned: {
        versionId: versionId("44444444-4444-7444-8444-444444444444"),
        textQuote: "q",
      },
    },
    parentCommentId: null,
    resolvedAt: null,
    createdAt: 1_700_000_000_000,
  };
}

describe("uniqueCommentAuthorIds", () => {
  it("dedupes a repeated author down to a single id, first-seen order", () => {
    const comments = [
      comment("aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa", authorA),
      comment("bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb", authorB),
      comment("cccccccc-cccc-7ccc-8ccc-cccccccccccc", authorA),
    ];
    expect(uniqueCommentAuthorIds(comments)).toEqual([authorA, authorB]);
  });

  it("returns an empty array for an empty comment list", () => {
    expect(uniqueCommentAuthorIds([])).toEqual([]);
  });
});
