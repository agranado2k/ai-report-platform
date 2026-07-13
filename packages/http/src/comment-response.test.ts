// Comment resource mappers (ADR-0064 §7, ADR-0053 conventions) — grouped in
// their own file since they're a new resource family, mirroring how
// upload-response.test.ts stands apart from write-response.test.ts.
import type { Comment } from "arp-domain";
import {
  commentId,
  commentIdToWire,
  err,
  ok,
  reportId,
  reportIdToWire,
  userId,
  userIdToWire,
  versionId,
  versionIdToWire,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import { listCommentsToHttp } from "./list-response";
import { addCommentToHttp, deleteCommentToHttp, resolveCommentToHttp } from "./write-response";

const CTX = { mode: "prod" as const };
const R1 = "00000000-0000-7000-8000-0000000000c1";
const U1 = "00000000-0000-7000-8000-0000000000d1";
const V1 = "00000000-0000-7000-8000-0000000000e1";
const C1 = "00000000-0000-7000-8000-0000000000f1";
const C2 = "00000000-0000-7000-8000-0000000000f2";

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: commentId(C1),
    reportId: reportId(R1),
    authorUserId: userId(U1),
    body: "What does this mean?",
    anchor: { versionPinned: { versionId: versionId(V1), textQuote: "the Q3 number" } },
    parentCommentId: null,
    intent: "note",
    resolvedAt: null,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

const commentResource = (overrides: Partial<Comment> = {}) => {
  const c = comment(overrides);
  return {
    object: "comment",
    id: commentIdToWire(c.id),
    report_id: reportIdToWire(c.reportId),
    author_id: userIdToWire(c.authorUserId),
    author: { id: userIdToWire(c.authorUserId), email: null, name: null },
    parent_id: c.parentCommentId ? commentIdToWire(c.parentCommentId) : null,
    body: c.body,
    intent: c.intent,
    anchor: {
      version_pinned: {
        version_id: versionIdToWire(c.anchor.versionPinned.versionId),
        text_quote: c.anchor.versionPinned.textQuote,
      },
    },
    resolved_at: c.resolvedAt === null ? null : new Date(c.resolvedAt).toISOString(),
    created_at: new Date(c.createdAt).toISOString(),
    mode: "prod",
  };
};

describe("addCommentToHttp", () => {
  it("→ 201 with the created comment resource (root, parent_id null)", () => {
    const res = addCommentToHttp(ok(comment()), CTX);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(commentResource());
  });

  it("→ 201 for a reply, with parent_id set", () => {
    const reply = comment({ id: commentId(C2), parentCommentId: commentId(C1) });
    const res = addCommentToHttp(ok(reply), CTX);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      commentResource({ id: commentId(C2), parentCommentId: commentId(C1) }),
    );
  });

  it("carries the comment's intent in the response body", () => {
    const res = addCommentToHttp(ok(comment({ intent: "enhancement" })), CTX);
    expect(res.body).toMatchObject({ intent: "enhancement" });
  });

  it("propagates an error as a problem+json response", () => {
    const res = addCommentToHttp(err({ kind: "NotAllowed", message: "no write access" }), CTX);
    expect(res.status).toBe(403);
    expect(res.contentType).toBe("application/problem+json");
  });
});

describe("resolveCommentToHttp", () => {
  it("→ 200 with the resolved comment resource", () => {
    const resolved = comment({ resolvedAt: 1_700_000_100_000 });
    const res = resolveCommentToHttp(ok(resolved), CTX);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(commentResource({ resolvedAt: 1_700_000_100_000 }));
  });

  it("NotAllowed (non-author, non-owner) → 403 problem", () => {
    const res = resolveCommentToHttp(
      err({ kind: "NotAllowed", message: "only the comment's author or the report's owner..." }),
      CTX,
    );
    expect(res.status).toBe(403);
  });
});

describe("deleteCommentToHttp", () => {
  it("→ 204 no body", () => {
    const res = deleteCommentToHttp(ok(undefined));
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
  });

  it("NotFound → 404 problem", () => {
    const res = deleteCommentToHttp(err({ kind: "NotFound", message: "comment not found" }));
    expect(res.status).toBe(404);
    expect(res.contentType).toBe("application/problem+json");
  });
});

describe("listCommentsToHttp", () => {
  it("→ 200 list envelope with comment resources, newest-created first as given", () => {
    const items = [comment({ id: commentId(C2) }), comment({ id: commentId(C1) })];
    const res = listCommentsToHttp(ok({ items, hasMore: true }), CTX);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      object: "list",
      data: [commentResource({ id: commentId(C2) }), commentResource({ id: commentId(C1) })],
      has_more: true,
    });
  });

  it("folds each comment's resolved author { name, email } in from the map", () => {
    const items = [comment({ id: commentId(C1) })];
    const authorByUserId = new Map([
      [userId(U1), { email: "alice@example.com", name: "Alice Ackerman" }],
    ]);
    const res = listCommentsToHttp(ok({ items, hasMore: false }), CTX, authorByUserId);
    const data = (
      res.body as { data: { author: { id: string; email: string | null; name: string | null } }[] }
    ).data;
    expect(data[0]?.author).toEqual({
      id: userIdToWire(userId(U1)),
      email: "alice@example.com",
      name: "Alice Ackerman",
    });
  });

  it("emits author.name null when the author has no display name (email only)", () => {
    const items = [comment({ id: commentId(C1) })];
    const authorByUserId = new Map([[userId(U1), { email: "alice@example.com", name: null }]]);
    const res = listCommentsToHttp(ok({ items, hasMore: false }), CTX, authorByUserId);
    const data = (res.body as { data: { author: { email: string | null; name: string | null } }[] })
      .data;
    expect(data[0]?.author).toMatchObject({ email: "alice@example.com", name: null });
  });

  it("falls back to author null name+email when the map has no entry for the author", () => {
    const items = [comment({ id: commentId(C1) })];
    const res = listCommentsToHttp(ok({ items, hasMore: false }), CTX, new Map());
    const data = (res.body as { data: { author: { email: string | null; name: string | null } }[] })
      .data;
    expect(data[0]?.author.email).toBeNull();
    expect(data[0]?.author.name).toBeNull();
  });

  it("propagates a NotAllowed (cross-org) error as a problem", () => {
    const res = listCommentsToHttp(
      err({ kind: "NotAllowed", message: "report is not in your org" }),
      CTX,
    );
    expect(res.status).toBe(403);
    expect(res.contentType).toBe("application/problem+json");
  });
});
