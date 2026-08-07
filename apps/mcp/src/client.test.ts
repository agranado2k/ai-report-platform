import { describe, expect, it } from "vitest";
import { ApiClient } from "./client";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: BodyInit | null | undefined;
}

/** A `fetch` stub that records calls and returns a canned Response. */
function stub(response: Response) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    });
    return response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("ApiClient", () => {
  it("searchReports GETs /api/v1/reports with cursor params + forwards the bearer", async () => {
    const { fn, calls } = stub(json({ object: "list", data: [], has_more: false }));
    const client = new ApiClient({
      baseUrl: "https://app.example.com",
      authorization: "Bearer arp_live_x",
      fetch: fn,
    });

    const r = await client.searchReports({ q: "metrics", limit: 2, startingAfter: "report_abc" });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.has_more).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://app.example.com/api/v1/reports?q=metrics&limit=2&starting_after=report_abc",
    );
    expect(calls[0]?.headers.authorization).toBe("Bearer arp_live_x");
  });

  it("getReport GETs /api/v1/reports/{slug} (slug encoded) and returns the summary", async () => {
    const { fn, calls } = stub(json({ slug: "ab/cd", title: "T", is_published: true }));
    const client = new ApiClient({
      baseUrl: "https://app.example.com",
      authorization: "Bearer arp_live_x",
      fetch: fn,
    });

    const r = await client.getReport("ab/cd");

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.title).toBe("T");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/reports/ab%2Fcd");
    expect(calls[0]?.method).toBe("GET");
  });

  it("listReportVersions GETs /api/v1/reports/{slug}/versions (slug encoded) with cursor params", async () => {
    const { fn, calls } = stub(json({ object: "list", data: [], has_more: false }));
    const client = new ApiClient({
      baseUrl: "https://app.example.com",
      authorization: "Bearer arp_live_x",
      fetch: fn,
    });

    const r = await client.listReportVersions("ab/cd", { limit: 5, startingAfter: "version_abc" });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.has_more).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://app.example.com/api/v1/reports/ab%2Fcd/versions?limit=5&starting_after=version_abc",
    );
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.headers.authorization).toBe("Bearer arp_live_x");
  });

  it("listFolders GETs /api/v1/folders and omits the auth header when none is set", async () => {
    const { fn, calls } = stub(json({ folders: [] }));
    const client = new ApiClient({
      baseUrl: "https://app.example.com",
      authorization: null,
      fetch: fn,
    });

    const r = await client.listFolders();

    expect(r.ok).toBe(true);
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/folders");
    expect(calls[0]?.headers.authorization).toBeUndefined();
  });

  it("maps an RFC-9457 problem+json error into a structured problem", async () => {
    const problem = json(
      {
        title: "Unauthorized",
        status: 401,
        detail: "invalid or revoked API key",
        code: "unauthenticated",
      },
      401,
    );
    const { fn } = stub(problem);
    const client = new ApiClient({
      baseUrl: "https://app.example.com",
      authorization: "Bearer bad",
      fetch: fn,
    });

    const r = await client.searchReports({});

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem.status).toBe(401);
      expect(r.problem.title).toBe("Unauthorized");
      expect(r.problem.code).toBe("unauthenticated");
      expect(r.problem.detail).toBe("invalid or revoked API key");
    }
  });

  it("falls back to a synthetic problem when the error body isn't JSON", async () => {
    const { fn } = stub(new Response("502 upstream", { status: 502 }));
    const client = new ApiClient({
      baseUrl: "https://app.example.com",
      authorization: null,
      fetch: fn,
    });

    const r = await client.listFolders();

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem.status).toBe(502);
  });
});

describe("ApiClient writes", () => {
  const client = (fn: typeof fetch) =>
    new ApiClient({
      baseUrl: "https://app.example.com",
      authorization: "Bearer arp_live_x",
      fetch: fn,
    });

  it("uploadReport POSTs multipart to /api/v1/reports and returns the result", async () => {
    const { fn, calls } = stub(json({ slug: "abc12345", view_url: "https://view/abc12345" }, 201));
    const r = await client(fn).uploadReport({ html: "<h1>hi</h1>" });

    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as { slug: string }).slug).toBe("abc12345");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/reports");
    expect(calls[0]?.body).toBeInstanceOf(FormData);
    // multipart: fetch sets the content-type+boundary itself — we must NOT set it.
    expect(calls[0]?.headers["content-type"]).toBeUndefined();
    const form = calls[0]?.body as FormData;
    expect(form.get("file")).toBeInstanceOf(File);
  });

  it("uploadReport passes update_slug / folder_path when given", async () => {
    const { fn, calls } = stub(json({ slug: "abc12345" }, 201));
    await client(fn).uploadReport({ html: "x", updateSlug: "abc12345", folderPath: "/q3" });
    const form = calls[0]?.body as FormData;
    expect(form.get("update_slug")).toBe("abc12345");
    expect(form.get("folder_path")).toBe("/q3");
  });

  it("renameReport PATCHes the slug with a JSON title", async () => {
    const { fn, calls } = stub(json({ slug: "abc", title: "New" }));
    await client(fn).renameReport("abc", "New");
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/reports/abc");
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(calls[0]?.body as string)).toEqual({ title: "New" });
  });

  it("moveReport POSTs {folder_id} to the move sub-resource", async () => {
    const { fn, calls } = stub(json({ slug: "abc" }));
    await client(fn).moveReport("abc", "fldr-1");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/reports/abc/move");
    expect(JSON.parse(calls[0]?.body as string)).toEqual({ folder_id: "fldr-1" });
  });

  it("deleteReport DELETEs and treats 204 as success with no body", async () => {
    const { fn, calls } = stub(new Response(null, { status: 204 }));
    const r = await client(fn).deleteReport("abc");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBeUndefined();
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/reports/abc");
  });

  it("createFolder POSTs {name, parent_id} to /api/v1/folders", async () => {
    const { fn, calls } = stub(json({ id: "f2", name: "Q3" }, 201));
    await client(fn).createFolder({ name: "Q3", parentId: "root" });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/folders");
    expect(JSON.parse(calls[0]?.body as string)).toEqual({ name: "Q3", parent_id: "root" });
  });

  it("renameFolder PATCHes the folder id with {name}", async () => {
    const { fn, calls } = stub(json({ id: "f2", name: "Q4" }));
    await client(fn).renameFolder("f2", "Q4");
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/folders/f2");
    expect(JSON.parse(calls[0]?.body as string)).toEqual({ name: "Q4" });
  });

  it("setFolderVisibility POSTs /visibility with {visibility}", async () => {
    const { fn, calls } = stub(json({ object: "folder", id: "f2", visibility: "private" }));
    const r = await client(fn).setFolderVisibility("f2", "private");
    expect(r.ok).toBe(true);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/folders/f2/visibility");
    expect(JSON.parse(calls[0]?.body as string)).toEqual({ visibility: "private" });
  });

  it("shareFolder POSTs /shares with the email", async () => {
    const { fn, calls } = stub(json({ object: "folder_share", email: "pal@x.com" }, 201));
    const r = await client(fn).shareFolder("f2", "pal@x.com");
    expect(r.ok).toBe(true);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/folders/f2/shares");
    expect(JSON.parse(calls[0]?.body as string)).toEqual({ email: "pal@x.com" });
  });

  it("unshareFolder DELETEs /shares/{email} (URL-encoded)", async () => {
    const { fn, calls } = stub(new Response(null, { status: 204 }));
    const r = await client(fn).unshareFolder("f2", "a+b@x.com");
    expect(r.ok).toBe(true);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/folders/f2/shares/a%2Bb%40x.com");
  });

  it("listFolderShares GETs the shares list envelope", async () => {
    const { fn, calls } = stub(
      json({
        object: "list",
        data: [{ object: "folder_share", email: "a@b.com" }],
        has_more: false,
      }),
    );
    const r = await client(fn).listFolderShares("f2");
    expect(r.ok).toBe(true);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/folders/f2/shares");
  });

  it("deleteFolder DELETEs the folder id (204 → success)", async () => {
    const { fn, calls } = stub(new Response(null, { status: 204 }));
    const r = await client(fn).deleteFolder("f2");
    expect(r.ok).toBe(true);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/folders/f2");
  });

  it("surfaces an RFC-9457 problem on a failed write", async () => {
    const { fn } = stub(json({ title: "Not Found", status: 404, code: "not_found" }, 404));
    const r = await client(fn).renameReport("missing", "x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem.code).toBe("not_found");
  });

  it("getReportAcl GETs /reports/{slug}/acl", async () => {
    const { fn, calls } = stub(
      json({
        object: "acl",
        mode: "allowlist",
        allowed_emails: ["a@b.com"],
        access_ttl_seconds: 604800,
      }),
    );
    const r = await client(fn).getReportAcl("abc12345");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.mode).toBe("allowlist");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/reports/abc12345/acl");
  });

  it("setReportAcl POSTs /acl with only the fields relevant to the mode", async () => {
    const { fn, calls } = stub(json({ object: "report", acl: { mode: "allowlist" } }));
    const r = await client(fn).setReportAcl("abc12345", {
      mode: "allowlist",
      allowedEmails: ["a@b.com"],
      accessTtlSeconds: 604800,
    });
    expect(r.ok).toBe(true);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/reports/abc12345/acl");
    const sent = JSON.parse(calls[0]?.body as string);
    expect(sent).toEqual({
      mode: "allowlist",
      allowed_emails: ["a@b.com"],
      access_ttl_seconds: 604800,
    });
    expect("password" in sent).toBe(false); // absent fields omitted
  });

  // ── ADR-0078: the three-state sharing + the folder bulk apply ───────────
  it("setReportSharing POSTs /sharing with the state", async () => {
    const { fn, calls } = stub(json({ object: "report", sharing: "org_view" }));
    const r = await client(fn).setReportSharing("abc12345", { sharing: "org_view" });
    expect(r.ok).toBe(true);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/reports/abc12345/sharing");
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(calls[0]?.body as string)).toEqual({ sharing: "org_view" });
  });

  it("setReportSharing OMITS confirm_discard when the caller did not pass it", async () => {
    // The protection this omission IS: the server refuses to leave
    // password/allowlist/public without an explicit `confirm_discard`, and
    // sending `false` — let alone defaulting to it — would quietly turn that
    // refusal into a client-side decision for every MCP caller.
    const { fn, calls } = stub(json({ object: "report", sharing: "private" }));
    await client(fn).setReportSharing("abc12345", { sharing: "private" });
    const sent = JSON.parse(calls[0]?.body as string);
    expect("confirm_discard" in sent).toBe(false);
  });

  it("setReportSharing omits confirm_discard when it is explicitly FALSE", async () => {
    const { fn, calls } = stub(json({ object: "report", sharing: "private" }));
    await client(fn).setReportSharing("abc12345", { sharing: "private", confirmDiscard: false });
    expect("confirm_discard" in JSON.parse(calls[0]?.body as string)).toBe(false);
  });

  it("setReportSharing forwards confirm_discard ONLY as an explicit true", async () => {
    const { fn, calls } = stub(json({ object: "report", sharing: "private" }));
    await client(fn).setReportSharing("abc12345", { sharing: "private", confirmDiscard: true });
    expect(JSON.parse(calls[0]?.body as string)).toEqual({
      sharing: "private",
      confirm_discard: true,
    });
  });

  it("setReportSharing surfaces the server's 422 refusal rather than retrying it", async () => {
    // The refusal carries the sentence naming what would be discarded; the
    // client must hand it back untouched, never re-send with the flag set.
    const { fn, calls } = stub(
      json({ error: { message: "This report is password-protected." } }, 422),
    );
    const r = await client(fn).setReportSharing("abc12345", { sharing: "private" });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("applyFolderSharingToReports POSTs the folder's reports/sharing sub-resource", async () => {
    const { fn, calls } = stub(
      json({
        object: "sharing_apply",
        sharing: "org_view",
        total: 2,
        changed: [{ slug: "a", title: "A" }],
        skipped: [{ slug: "b", title: "B", reason: "not owned by you" }],
        failed: [],
      }),
    );
    const r = await client(fn).applyFolderSharingToReports("fldr_1", "org_view");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.skipped[0]?.reason).toBe("not owned by you");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/folders/fldr_1/reports/sharing");
    expect(JSON.parse(calls[0]?.body as string)).toEqual({ sharing: "org_view" });
  });

  it("applyFolderSharingToReports URL-encodes the folder id", async () => {
    const { fn, calls } = stub(json({ object: "sharing_apply", sharing: "private" }));
    await client(fn).applyFolderSharingToReports("a/b?c", "private");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/folders/a%2Fb%3Fc/reports/sharing");
  });

  it("grantWrite POSTs /write-grants with the email", async () => {
    const { fn, calls } = stub(json({ object: "write_grant", email: "grantee@x.com" }, 201));
    const r = await client(fn).grantWrite("abc12345", "grantee@x.com");
    expect(r.ok).toBe(true);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/reports/abc12345/write-grants");
    expect(JSON.parse(calls[0]?.body as string)).toEqual({ email: "grantee@x.com" });
  });

  it("revokeWrite DELETEs /write-grants/{email} (URL-encoded)", async () => {
    const { fn, calls } = stub(new Response(null, { status: 204 }));
    const r = await client(fn).revokeWrite("abc12345", "a+b@x.com");
    expect(r.ok).toBe(true);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe(
      "https://app.example.com/api/v1/reports/abc12345/write-grants/a%2Bb%40x.com",
    );
  });

  it("listWriteGrants GETs the write-grants list envelope", async () => {
    const { fn, calls } = stub(
      json({
        object: "list",
        data: [{ object: "write_grant", email: "a@b.com" }],
        has_more: false,
      }),
    );
    const r = await client(fn).listWriteGrants("abc12345");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.data).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/reports/abc12345/write-grants");
  });
});

describe("ApiClient comments", () => {
  const client = (fn: typeof fetch) =>
    new ApiClient({
      baseUrl: "https://app.example.com",
      authorization: "Bearer arp_live_x",
      fetch: fn,
    });

  it("listComments GETs /reports/{slug}/comments (slug encoded) with no cursor", async () => {
    const { fn, calls } = stub(json({ object: "list", data: [], has_more: false }));
    const r = await client(fn).listComments("ab/cd");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.has_more).toBe(false);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/reports/ab%2Fcd/comments");
    expect(calls[0]?.headers.authorization).toBe("Bearer arp_live_x");
  });

  it("listComments forwards cursor params (limit/starting_after)", async () => {
    const { fn, calls } = stub(json({ object: "list", data: [], has_more: true }));
    const r = await client(fn).listComments("abc12345", {
      limit: 5,
      startingAfter: "comment_abc",
    });
    expect(r.ok).toBe(true);
    expect(calls[0]?.url).toBe(
      "https://app.example.com/api/v1/reports/abc12345/comments?limit=5&starting_after=comment_abc",
    );
  });

  it("listComments forwards ending_before for paging back", async () => {
    const { fn, calls } = stub(json({ object: "list", data: [], has_more: false }));
    await client(fn).listComments("abc12345", { endingBefore: "comment_zzz" });
    expect(calls[0]?.url).toBe(
      "https://app.example.com/api/v1/reports/abc12345/comments?ending_before=comment_zzz",
    );
  });

  it("addComment POSTs a root comment with the anchor and no parent_comment_id", async () => {
    const { fn, calls } = stub(json({ object: "comment", id: "comment_1", parent_id: null }, 201));
    const r = await client(fn).addComment("abc12345", {
      body: "What does this mean?",
      versionId: "version_1",
      textQuote: "the Q3 number",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as { id: string }).id).toBe("comment_1");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/reports/abc12345/comments");
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(calls[0]?.body as string)).toEqual({
      body: "What does this mean?",
      anchor: {
        version_pinned: { version_id: "version_1", text_quote: "the Q3 number" },
      },
    });
  });

  it("addComment includes relative when passed", async () => {
    const { fn, calls } = stub(json({ object: "comment", id: "comment_1" }, 201));
    await client(fn).addComment("abc12345", {
      body: "note",
      versionId: "version_1",
      textQuote: "quote",
      relative: { css: "#heading" },
    });
    expect(JSON.parse(calls[0]?.body as string)).toEqual({
      body: "note",
      anchor: {
        version_pinned: { version_id: "version_1", text_quote: "quote" },
        relative: { css: "#heading" },
      },
    });
  });

  it("addComment POSTs a reply with parent_comment_id set", async () => {
    const { fn, calls } = stub(
      json({ object: "comment", id: "comment_2", parent_id: "comment_1" }, 201),
    );
    const r = await client(fn).addComment("abc12345", {
      body: "a reply",
      versionId: "version_1",
      textQuote: "quote",
      parentCommentId: "comment_1",
    });
    expect(r.ok).toBe(true);
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body as string)).toEqual({
      body: "a reply",
      anchor: {
        version_pinned: { version_id: "version_1", text_quote: "quote" },
      },
      parent_comment_id: "comment_1",
    });
  });

  it("resolveComment PATCHes /comments/{comment_id} (both ids encoded) with no body", async () => {
    const { fn, calls } = stub(
      json({ object: "comment", id: "comment_1", resolved_at: "2026-07-08T00:00:00.000Z" }),
    );
    const r = await client(fn).resolveComment("ab/cd", "comment_1");
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as { resolved_at: string }).resolved_at).toBeTruthy();
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/reports/ab%2Fcd/comments/comment_1");
    expect(calls[0]?.body).toBeUndefined();
  });

  it("deleteComment DELETEs /comments/{comment_id} and treats 204 as success", async () => {
    const { fn, calls } = stub(new Response(null, { status: 204 }));
    const r = await client(fn).deleteComment("abc12345", "comment_1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBeUndefined();
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe(
      "https://app.example.com/api/v1/reports/abc12345/comments/comment_1",
    );
  });

  it("surfaces an RFC-9457 problem when the caller lacks write access", async () => {
    const { fn } = stub(json({ title: "Forbidden", status: 403, code: "forbidden" }, 403));
    const r = await client(fn).addComment("abc12345", {
      body: "x",
      versionId: "version_1",
      textQuote: "q",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem.code).toBe("forbidden");
  });
});

// ── Idempotency-Key + transport retry (issue #233 follow-up) ───────────────
//
// ADR-0039's amendment removed the server-side DERIVED key for state-setting
// writes, because a key derived from the payload replays A -> B -> A. The
// mitigation it names is "clients wanting exactly-once retry semantics send an
// Idempotency-Key" — but this client sent none at all, so via MCP a retried
// DELETE surfaced 404 for a call that had actually succeeded, and a retried
// api-key create minted a second credential.
//
// The key must identify an ATTEMPT, never the payload: deriving it from the
// body here would re-create the exact bug #233 fixed. So it is minted once per
// logical call and REUSED across transport retries of that same call — which
// is what makes the retry safe rather than merely repeated.
describe("ApiClient — idempotency", () => {
  const retryable = new Response("", { status: 503 });

  /** A stub that fails `failures` times, then succeeds. */
  function flaky(failures: number, ok: Response) {
    const calls: { headers: Record<string, string>; method: string }[] = [];
    let n = 0;
    const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        headers: (init?.headers ?? {}) as Record<string, string>,
        method: init?.method ?? "GET",
      });
      n += 1;
      // Clone BOTH: a Response body is single-use, so returning the same
      // object twice fails on the second read — a defect in the stub, not
      // in the client under test.
      return n <= failures ? retryable.clone() : ok.clone();
    }) as unknown as typeof fetch;
    return { fn, calls };
  }

  const client = (fetchImpl: typeof fetch) =>
    new ApiClient({
      baseUrl: "https://app.example.com",
      authorization: "Bearer x",
      fetch: fetchImpl,
    });

  it("sends an Idempotency-Key on a mutating request", async () => {
    const { fn, calls } = flaky(0, json({ object: "report", slug: "aaaaaaaaaa" }));

    await client(fn).deleteReport("aaaaaaaaaa");

    expect(calls[0]?.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does NOT send one on a read", async () => {
    const { fn, calls } = flaky(0, json({ object: "list", data: [], has_more: false }));

    await client(fn).searchReports({ limit: 1 });

    expect(calls[0]?.headers["idempotency-key"]).toBeUndefined();
  });

  it("REUSES the same key across transport retries — the whole point", async () => {
    const { fn, calls } = flaky(1, json({ object: "report", slug: "aaaaaaaaaa" }));

    await client(fn).deleteReport("aaaaaaaaaa");

    expect(calls.length).toBe(2);
    expect(calls[0]?.headers["idempotency-key"]).toBe(calls[1]?.headers["idempotency-key"]);
  });

  it("mints a DIFFERENT key for a genuinely new call", async () => {
    const { fn, calls } = flaky(0, json({ object: "report", slug: "aaaaaaaaaa" }));
    const c = client(fn);

    await c.deleteReport("aaaaaaaaaa");
    await c.deleteReport("aaaaaaaaaa");

    // Same payload, same route — a payload-derived key would collide here and
    // make the second call a no-op replay. That is #233 in miniature.
    expect(calls[0]?.headers["idempotency-key"]).not.toBe(calls[1]?.headers["idempotency-key"]);
  });

  it("gives up after the bounded number of attempts", async () => {
    const { fn, calls } = flaky(99, json({}));

    const r = await client(fn).deleteReport("aaaaaaaaaa");

    expect(r.ok).toBe(false);
    expect(calls.length).toBeLessThanOrEqual(3);
  });

  it("does not retry a 4xx — it is the caller's request that is wrong", async () => {
    const calls: string[] = [];
    const fn = (async () => {
      calls.push("x");
      return json({ title: "Not found" }, 404);
    }) as unknown as typeof fetch;

    await client(fn).deleteReport("aaaaaaaaaa");

    expect(calls.length).toBe(1);
  });
});
