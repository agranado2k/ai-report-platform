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
