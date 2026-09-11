// The viewer origin's shared non-render responses (`viewer-responses.ts`).
//
// These used to be three near-identical private helpers — `notFoundResponse`
// and `redirectToPublicViewer` in `$slug_.edit.tsx`, and a third copy plus an
// inline 303 block in `$slug_.view.tsx`. What only a test at this level can
// hold honest is the property that made them worth sharing: EVERY response
// that carries no first-party UI wears the PUBLIC header profile, and every
// one of them is `no-store` and `noindex`. A copy that quietly drifted — a
// missing `x-robots-tag`, an `editViewHeaders()` on a bare redirect — is a
// leak that no route test would notice, because the route under test would
// still redirect to the right place.
import { describe, expect, it } from "vitest";
import { viewerRedirectResponse, viewerTextResponse } from "./viewer-responses";

describe("viewerTextResponse", () => {
  it("carries the status, the body and a plain-text content type", async () => {
    const res = viewerTextResponse(404, "Not found");

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("is never cached and never indexed", () => {
    const res = viewerTextResponse(410, "Gone");

    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("wears the PUBLIC header profile — no authenticated-route CSP", () => {
    // The whole reason these are shared: a response with no first-party UI in
    // it gets the stricter, unauthenticated header set. `editViewHeaders()`
    // relaxes `frame-src` to `'self'` so the owner view can frame the report;
    // a bare 404 has nothing to frame and must not carry that permission.
    const csp = viewerTextResponse(404, "Not found").headers.get("Content-Security-Policy") ?? "";

    expect(csp).toContain("sandbox");
    expect(csp).not.toContain("frame-src 'self'");
  });
});

describe("viewerRedirectResponse", () => {
  it("sets the Location and defaults to carrying no cookies", () => {
    const res = viewerRedirectResponse("/abcde12345", 302);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/abcde12345");
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("APPENDS every cookie rather than setting them", () => {
    // `set` would silently collapse the owner view's three-capability hand-off
    // (ADR-0089 §4) to the last one, and the failure would surface as a frame
    // sitting at the unlock wall — nowhere near this line.
    const res = viewerRedirectResponse("/abcde12345/view", 303, [
      "arp_view=a; Path=/abcde12345/view",
      "arp_view_oa=b; Path=/abcde12345/view",
      "arp_unlock=c; Path=/abcde12345",
    ]);

    expect(res.status).toBe(303);
    expect(res.headers.getSetCookie()).toEqual([
      "arp_view=a; Path=/abcde12345/view",
      "arp_view_oa=b; Path=/abcde12345/view",
      "arp_unlock=c; Path=/abcde12345",
    ]);
  });

  it("is never cached and never indexed, and wears the PUBLIC profile", () => {
    const res = viewerRedirectResponse("/abcde12345", 302);

    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("Content-Security-Policy") ?? "").toContain("sandbox");
  });

  it("has an empty body — a redirect is not a document", () => {
    expect(viewerRedirectResponse("/abcde12345", 302).body).toBeNull();
  });
});
