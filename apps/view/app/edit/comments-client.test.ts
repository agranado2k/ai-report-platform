import { describe, expect, it, vi } from "vitest";
import {
  addComment,
  editComment,
  listComments,
  replyToComment,
  resolveComment,
} from "./comments-client";
import type { CommentWire } from "./wire-types";

const COMMENT: CommentWire = {
  object: "comment",
  id: "comment_abc",
  report_id: "report_xyz",
  author_id: "user_1",
  parent_id: null,
  body: "Nice chart.",
  intent: "note",
  anchor: {
    version_pinned: { version_id: "version_1", text_quote: "the quarterly numbers" },
    relative: { from: 3, to: 9 },
  },
  resolved_at: null,
  created_at: "2026-07-08T00:00:00.000Z",
  mode: "prod",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BASE = {
  appOrigin: "https://app.centaurspec.com",
  slug: "abc1234567",
  editToken: "tok.sig",
};

describe("listComments", () => {
  it("GETs the comments list with a Bearer edit token, credentials omitted", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { object: "list", data: [COMMENT], has_more: false }));

    const result = await listComments({ ...BASE, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://app.centaurspec.com/api/v1/reports/abc1234567/comments?limit=100");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok.sig");
    expect(result).toEqual({ ok: true, comments: [COMMENT], has_more: false });
  });

  it("follows the cursor with starting_after across pages and accumulates every comment", async () => {
    const c1: CommentWire = { ...COMMENT, id: "comment_1" };
    const c2: CommentWire = { ...COMMENT, id: "comment_2" };
    const c3: CommentWire = { ...COMMENT, id: "comment_3" };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { object: "list", data: [c1, c2], has_more: true }))
      .mockResolvedValueOnce(jsonResponse(200, { object: "list", data: [c3], has_more: false }));

    const result = await listComments({ ...BASE, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstUrl = (fetchImpl.mock.calls[0] as [string, RequestInit])[0] as string;
    const secondUrl = (fetchImpl.mock.calls[1] as [string, RequestInit])[0] as string;
    // Page 1 carries no cursor; page 2 pins starting_after to the last id of page 1.
    expect(firstUrl).toBe(
      "https://app.centaurspec.com/api/v1/reports/abc1234567/comments?limit=100",
    );
    expect(secondUrl).toContain("limit=100");
    expect(secondUrl).toContain("starting_after=comment_2");
    // The full set is returned in page order, and has_more is now false (drained).
    expect(result).toEqual({ ok: true, comments: [c1, c2, c3], has_more: false });
  });

  it("stops at the page cap and reports has_more:true when the server never drains", async () => {
    let n = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      n += 1;
      return jsonResponse(200, {
        object: "list",
        data: [{ ...COMMENT, id: `comment_${n}` }],
        has_more: true,
      });
    });

    const result = await listComments({ ...BASE, fetchImpl });

    // Bounded: the loop never spins forever — it caps the number of pages.
    expect(fetchImpl).toHaveBeenCalledTimes(20);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.has_more).toBe(true); // signals the set was truncated at the cap
      expect(result.comments).toHaveLength(20);
    }
  });

  it("propagates a mid-pagination failure instead of returning a partial set", async () => {
    const c1: CommentWire = { ...COMMENT, id: "comment_1" };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { object: "list", data: [c1], has_more: true }))
      .mockResolvedValueOnce(jsonResponse(401, {}));

    const result = await listComments({ ...BASE, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.expired).toBe(true);
  });

  it("maps a 401 to an expired-session failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    const result = await listComments({ ...BASE, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.expired).toBe(true);
  });

  it("maps a network failure to a non-expired error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("offline"));
    const result = await listComments({ ...BASE, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.expired).toBe(false);
  });
});

describe("addComment", () => {
  it("POSTs a root comment with the wire-encoded anchor, JSON content-type, Bearer auth", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, COMMENT));

    const result = await addComment({
      ...BASE,
      fetchImpl,
      body: "Nice chart.",
      anchor: {
        versionId: "version_1",
        textQuote: "the quarterly numbers",
        relative: { from: 3, to: 9 },
      },
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://app.centaurspec.com/api/v1/reports/abc1234567/comments");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer tok.sig");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      body: "Nice chart.",
      anchor: {
        version_pinned: { version_id: "version_1", text_quote: "the quarterly numbers" },
        relative: { from: 3, to: 9 },
      },
    });
    expect(result).toEqual({ ok: true, comment: COMMENT });
  });

  it("includes the intent in the POST body when supplied, and omits it otherwise", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(201, COMMENT));
    await addComment({
      ...BASE,
      fetchImpl,
      body: "please enhance",
      intent: "enhancement",
      anchor: { versionId: "version_1", textQuote: "quote" },
    });
    const withIntent = JSON.parse(
      (fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(withIntent.intent).toBe("enhancement");

    await addComment({
      ...BASE,
      fetchImpl,
      body: "hi",
      anchor: { versionId: "version_1", textQuote: "quote" },
    });
    const withoutIntent = JSON.parse(
      (fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string,
    );
    expect("intent" in withoutIntent).toBe(false);
  });

  it("omits 'relative' from the wire anchor when absent (version-pinned only)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, COMMENT));
    await addComment({
      ...BASE,
      fetchImpl,
      body: "hi",
      anchor: { versionId: "version_1", textQuote: "quote" },
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(init.body as string);
    expect(parsed.anchor).toEqual({
      version_pinned: { version_id: "version_1", text_quote: "quote" },
    });
    expect("relative" in parsed.anchor).toBe(false);
  });

  it("maps a validation failure to its problem+json detail", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(422, {
        type: "about:blank",
        title: "Validation error",
        status: 422,
        detail: "anchor is required",
        code: "validation_error",
      }),
    );
    const result = await addComment({
      ...BASE,
      fetchImpl,
      body: "",
      anchor: { versionId: "version_1", textQuote: "quote" },
    });
    expect(result).toEqual({ ok: false, expired: false, message: "anchor is required" });
  });
});

describe("replyToComment", () => {
  it("POSTs with parent_comment_id set, reusing the same anchor shape", async () => {
    const reply: CommentWire = { ...COMMENT, id: "comment_reply", parent_id: COMMENT.id };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, reply));

    const result = await replyToComment({
      ...BASE,
      fetchImpl,
      parentCommentId: COMMENT.id,
      body: "Agreed.",
      anchor: { versionId: "version_1", textQuote: "the quarterly numbers" },
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(init.body as string);
    expect(parsed.parent_comment_id).toBe(COMMENT.id);
    expect(result).toEqual({ ok: true, comment: reply });
  });

  it("includes the intent in the POST body when supplied, and omits it otherwise", async () => {
    const reply: CommentWire = { ...COMMENT, id: "comment_reply", parent_id: COMMENT.id };
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(201, reply));

    await replyToComment({
      ...BASE,
      fetchImpl,
      parentCommentId: COMMENT.id,
      body: "please add this",
      intent: "add",
      anchor: { versionId: "version_1", textQuote: "quote" },
    });
    const withIntent = JSON.parse(
      (fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(withIntent.intent).toBe("add");
    expect(withIntent.parent_comment_id).toBe(COMMENT.id);

    await replyToComment({
      ...BASE,
      fetchImpl,
      parentCommentId: COMMENT.id,
      body: "no intent here",
      anchor: { versionId: "version_1", textQuote: "quote" },
    });
    const withoutIntent = JSON.parse(
      (fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string,
    );
    expect("intent" in withoutIntent).toBe(false);
  });
});

describe("resolveComment", () => {
  it("PATCHes .../comments/{comment_id} with no request body", async () => {
    const resolved: CommentWire = { ...COMMENT, resolved_at: "2026-07-08T01:00:00.000Z" };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, resolved));

    const result = await resolveComment({ ...BASE, fetchImpl, commentId: COMMENT.id });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://app.centaurspec.com/api/v1/reports/abc1234567/comments/comment_abc");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBeUndefined();
    expect(result).toEqual({ ok: true, comment: resolved });
  });

  it("maps a 403 (write grant revoked mid-session) to an expired-session failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, {}));
    const result = await resolveComment({ ...BASE, fetchImpl, commentId: COMMENT.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.expired).toBe(true);
  });
});

describe("editComment", () => {
  it("PATCHes with a JSON body carrying body + intent, Bearer auth, credentials omitted", async () => {
    const edited: CommentWire = { ...COMMENT, body: "fixed typo", intent: "enhancement" };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, edited));

    const result = await editComment({
      ...BASE,
      fetchImpl,
      commentId: COMMENT.id,
      body: "fixed typo",
      intent: "enhancement",
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://app.centaurspec.com/api/v1/reports/abc1234567/comments/comment_abc");
    expect(init.method).toBe("PATCH");
    expect(init.credentials).toBe("omit");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer tok.sig");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ body: "fixed typo", intent: "enhancement" });
    expect(result).toEqual({ ok: true, comment: edited });
  });

  it("sends only the fields supplied — a body-only edit omits intent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, COMMENT));
    await editComment({ ...BASE, fetchImpl, commentId: COMMENT.id, body: "just the body" });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(init.body as string);
    expect(parsed).toEqual({ body: "just the body" });
    expect("intent" in parsed).toBe(false);
  });

  it("maps a validation failure (empty body) to its problem+json detail", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(422, {
        type: "about:blank",
        title: "Validation error",
        status: 422,
        detail: "comment body must be a non-empty string",
        code: "validation_error",
      }),
    );
    const result = await editComment({ ...BASE, fetchImpl, commentId: COMMENT.id, body: "  " });
    expect(result).toEqual({
      ok: false,
      expired: false,
      message: "comment body must be a non-empty string",
    });
  });
});
