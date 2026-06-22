import { describe, expect, it } from "vitest";
import { ApiClient } from "./client";

/** A `fetch` stub that records calls and returns a canned Response. */
function stub(response: Response) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("ApiClient", () => {
  it("searchReports GETs /api/v1/reports with the params and forwards the bearer", async () => {
    const { fn, calls } = stub(json({ reports: [], page: 2, page_size: 20, total: 0 }));
    const client = new ApiClient({
      baseUrl: "https://app.example.com",
      authorization: "Bearer arp_live_x",
      fetch: fn,
    });

    const r = await client.searchReports({ q: "metrics", page: 2 });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.total).toBe(0);
    expect(calls[0]?.url).toBe("https://app.example.com/api/v1/reports?q=metrics&page=2");
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
