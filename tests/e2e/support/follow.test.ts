// Unit coverage for the redirect-chain follower (tests/e2e/support/follow.ts).
//
// The helper exists because the e2e suite kept asserting an INTERMEDIATE hop
// and stopping: `editor-auth.steps.ts` asserted the 303 off `/{slug}/edit?et=…`
// and went no further, and BOTH production incidents (#188's re-nested route
// and the ADR-0080 owner lockout) happened on the request AFTER it. A helper
// that walks a chain to its terminal state is only trustworthy if its own edge
// cases — cookie carry-over, cross-origin hops, relative Locations, loops, the
// hop cap — are pinned somewhere that runs in the fast gate, which is here: the
// helper takes a structural `get(url, {headers, maxRedirects})` seam, so a
// hand-written fake exercises every branch with no browser and no deployment.
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_HOPS, followToTerminal } from "./follow";

type FakeHop = {
  readonly status: number;
  readonly location?: string;
  readonly setCookie?: readonly string[];
  readonly body?: string;
};

type FakeCall = { readonly url: string; readonly headers: Record<string, string> };

/** A stand-in for Playwright's `APIRequestContext`, keyed by request URL.
 *  A route may be a single response or a queue consumed in order (so a test
 *  can make the SAME url answer differently on a second visit). */
function fakeRequest(routes: Record<string, FakeHop | readonly FakeHop[]>) {
  const calls: FakeCall[] = [];
  const queues = new Map<string, FakeHop[]>(
    Object.entries(routes).map(([url, hop]) => [url, Array.isArray(hop) ? [...hop] : [hop]]),
  );
  return {
    calls,
    get: async (url: string, options: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: { ...(options.headers ?? {}) } });
      const queue = queues.get(url);
      const hop = queue && (queue.length > 1 ? queue.shift() : queue[0]);
      if (!hop) throw new Error(`the fake has no route for ${url}`);
      const headers: Record<string, string> = {};
      if (hop.location) headers.location = hop.location;
      return {
        status: () => hop.status,
        url: () => url,
        headers: () => headers,
        headersArray: () => (hop.setCookie ?? []).map((value) => ({ name: "set-cookie", value })),
        text: async () => hop.body ?? "",
      };
    },
  };
}

describe("followToTerminal", () => {
  it("returns the terminal state directly when the first response is not a redirect", async () => {
    const request = fakeRequest({ "https://app.example/x": { status: 200, body: "<html>hi" } });

    const terminal = await followToTerminal(request, "https://app.example/x");

    expect(terminal.status).toBe(200);
    expect(terminal.url).toBe("https://app.example/x");
    expect(terminal.body).toBe("<html>hi");
    expect(terminal.hops).toEqual([{ url: "https://app.example/x", status: 200, location: null }]);
  });

  it("follows a redirect ACROSS ORIGINS and reports the terminal hop, not the first", async () => {
    const request = fakeRequest({
      "https://app.example/reports/abc/open": {
        status: 303,
        location: "https://view.example/abc/edit?et=tok",
      },
      "https://view.example/abc/edit?et=tok": { status: 200, body: "editor" },
    });

    const terminal = await followToTerminal(request, "https://app.example/reports/abc/open");

    expect(terminal.status).toBe(200);
    expect(terminal.url).toBe("https://view.example/abc/edit?et=tok");
    expect(terminal.body).toBe("editor");
    expect(terminal.hops.map((h) => h.status)).toEqual([303, 200]);
    expect(terminal.hops[0]?.location).toBe("https://view.example/abc/edit?et=tok");
  });

  it("carries a cookie set on one origin into the next hop on ANOTHER origin", async () => {
    const request = fakeRequest({
      "https://view.example/abc/edit?et=tok": {
        status: 303,
        location: "/abc/edit",
        setCookie: ["arp_edit=tokenvalue; Path=/; HttpOnly; SameSite=Lax"],
      },
      "https://view.example/abc/edit": { status: 200, body: "editor" },
    });

    await followToTerminal(request, "https://view.example/abc/edit?et=tok");

    expect(request.calls[1]?.headers.Cookie).toBe("arp_edit=tokenvalue");
  });

  it("accumulates several cookies, including two folded into one Set-Cookie header", async () => {
    const request = fakeRequest({
      "https://view.example/a": {
        status: 303,
        location: "/b",
        setCookie: [
          "arp_edit=one; Path=/; Expires=Wed, 09 Jun 2027 10:18:14 GMT, arp_edit_oa=two; Path=/",
        ],
      },
      "https://view.example/b": { status: 200 },
    });

    await followToTerminal(request, "https://view.example/a");

    expect(request.calls[1]?.headers.Cookie).toBe("arp_edit=one; arp_edit_oa=two");
  });

  it("merges caller-supplied cookies with the ones the chain sets, newest winning", async () => {
    const request = fakeRequest({
      "https://view.example/a": { status: 303, location: "/b", setCookie: ["s=fresh; Path=/"] },
      "https://view.example/b": { status: 200 },
    });

    await followToTerminal(request, "https://view.example/a", {
      headers: { Cookie: "s=stale; other=kept" },
    });

    expect(request.calls[0]?.headers.Cookie).toBe("s=stale; other=kept");
    expect(request.calls[1]?.headers.Cookie).toBe("s=fresh; other=kept");
  });

  it("drops a cookie the chain clears, rather than replaying an empty value", async () => {
    const request = fakeRequest({
      "https://view.example/a": { status: 303, location: "/b", setCookie: ["s=; Max-Age=0"] },
      "https://view.example/b": { status: 200 },
    });

    await followToTerminal(request, "https://view.example/a", { headers: { Cookie: "s=stale" } });

    expect(request.calls[1]?.headers.Cookie).toBeUndefined();
  });

  it("passes non-cookie caller headers through on every hop", async () => {
    const request = fakeRequest({
      "https://view.example/a": { status: 307, location: "/b" },
      "https://view.example/b": { status: 200 },
    });

    await followToTerminal(request, "https://view.example/a", {
      headers: { "x-vercel-protection-bypass": "s3cret" },
    });

    expect(request.calls.map((c) => c.headers["x-vercel-protection-bypass"])).toEqual([
      "s3cret",
      "s3cret",
    ]);
  });

  it("resolves a relative Location against the hop that issued it", async () => {
    const request = fakeRequest({
      "https://view.example/deep/page": { status: 302, location: "../other" },
      "https://view.example/other": { status: 200 },
    });

    const terminal = await followToTerminal(request, "https://view.example/deep/page");

    expect(terminal.url).toBe("https://view.example/other");
  });

  it("fails loudly on a redirect loop instead of hanging, naming the chain", async () => {
    const request = fakeRequest({
      "https://view.example/a": { status: 302, location: "/b" },
      "https://view.example/b": { status: 302, location: "/a" },
    });

    await expect(followToTerminal(request, "https://view.example/a")).rejects.toThrow(
      /redirect loop[\s\S]*302 https:\/\/view\.example\/a[\s\S]*302 https:\/\/view\.example\/b/,
    );
  });

  it("stops at the hop cap rather than following an unbounded chain", async () => {
    // Every hop is a NEW url, so the loop detector never fires — only the cap
    // can stop this, which is the point.
    const routes: Record<string, FakeHop> = {};
    for (let i = 0; i < 50; i += 1) {
      routes[`https://view.example/${i}`] = { status: 302, location: `/${i + 1}` };
    }
    const request = fakeRequest(routes);

    await expect(
      followToTerminal(request, "https://view.example/0", { maxHops: 3 }),
    ).rejects.toThrow(/still redirecting after 3 hops/);
    expect(request.calls).toHaveLength(3);
  });

  it("defaults the cap to DEFAULT_MAX_HOPS", async () => {
    const routes: Record<string, FakeHop> = {};
    for (let i = 0; i < 50; i += 1) {
      routes[`https://view.example/${i}`] = { status: 302, location: `/${i + 1}` };
    }
    const request = fakeRequest(routes);

    await expect(followToTerminal(request, "https://view.example/0")).rejects.toThrow(
      new RegExp(`still redirecting after ${DEFAULT_MAX_HOPS} hops`),
    );
    expect(request.calls).toHaveLength(DEFAULT_MAX_HOPS);
  });

  it("fails loudly on a redirect status carrying no Location header", async () => {
    const request = fakeRequest({ "https://view.example/a": { status: 302 } });

    await expect(followToTerminal(request, "https://view.example/a")).rejects.toThrow(
      /302 with no Location header/,
    );
  });
});
