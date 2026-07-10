import { describe, expect, it, vi } from "vitest";
import { addComment, listComments, replyToComment, resolveComment } from "./comments-client";
import type { CommentWire } from "./wire-types";

const COMMENT: CommentWire = {
  object: "comment",
  id: "comment_abc",
  report_id: "report_xyz",
  author_id: "user_1",
  parent_id: null,
  body: "Nice chart.",
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
    expect(result).toEqual({ ok: true, comments: [COMMENT] });
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
