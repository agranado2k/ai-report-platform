// BROWSER proof of the framing contract that the owner view rests on
// (ADR-0089 §2, ADR-0088's `frame-ancestors 'self'`).
//
// ADR-0088 shipped `frame-ancestors 'none'` → `'self'` with an operator's
// manual browser check as its evidence, and recorded that "the browser-tier
// regression test that locks both halves in lands with the owner view ticket
// #361". This is that test.
//
// WHY IT CANNOT BE A NODE TEST. Both halves are facts about a browser
// enforcing a header. A unit test can assert that the string
// `frame-ancestors 'self'` is in a response; it cannot assert that Chromium
// refuses a frame because of it, and it certainly cannot assert which cookies
// a nested navigation carries. A green header assertion says the string is
// served, not that anything enforces it.
//
// WHY IT NEEDS A SERVER (ADR-0089 §7, amending ADR-0079 §4). The rest of this
// tier runs over `file://`. Neither half of this contract is expressible
// there: `frame-ancestors` has no meaning without an origin, and cookies do
// not exist. So this spec binds an ephemeral `node:http` server to 127.0.0.1
// on an OS-assigned port and kills it in `afterAll`. That is still hermetic in
// every sense ADR-0079 cared about — no deployment, no credentials, no
// database, no network — and it is the instrument the 2026-09-09 spike used to
// establish the contract in the first place.
//
// THE HEADERS ARE THE REAL ONES. `viewHeaders()` and `editViewHeaders()` are
// imported and served verbatim, never restated as strings. ADR-0088's rule: a
// test that retypes the policy proves only that someone typed it twice, and
// would keep passing after the shipped policy changed underneath it.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
// Reached by path, the way `harness/build.mts` reaches into `apps/view`: this
// tier is not a workspace package and has no dependency on `arp-headers`.
// What matters is that these are the SHIPPED builders — importing them by any
// route beats restating their output as a string.
import { editViewHeaders, viewHeaders } from "../../packages/headers/src/view-headers";

const SLUG = "abcde12345";
const OTHER_SLUG = "zzzzzzzzzz";
const UNLOCK = "arp_unlock";

/** Every request the server saw, so a test can ask what the BROWSER did —
 *  which navigations happened at all, and what each one carried. */
interface Seen {
  readonly path: string;
  readonly cookie: string | undefined;
  readonly dest: string | undefined;
}

let server: Server;
let origin: string;
let seen: Seen[] = [];

/** The report document. Deliberately script-bearing: `allow-scripts` without
 *  `allow-same-origin` is the pairing under test, so a report that does not
 *  run script would prove nothing about it. */
function reportHtml(label: string): string {
  return `<!doctype html><html><head><title>${label}</title></head><body>
<h1 id="label">${label}</h1>
<p id="probe">unset</p>
<iframe id="nested" src="/${OTHER_SLUG}"></iframe>
<script>
  // Report-authored script, running in whatever origin the embedder gave it.
  var out = [];
  try { out.push("cookie:" + (document.cookie === "" ? "empty" : "readable")); }
  catch (e) { out.push("cookie:threw"); }
  try { void window.parent.document; out.push("parent:readable"); }
  catch (e) { out.push("parent:threw"); }
  document.getElementById("probe").textContent = out.join(" ");
</script>
</body></html>`;
}

/** The chrome page — a first-party view-origin document that frames the
 *  report exactly the way `ReportFrame` does. Kept in sync with
 *  `apps/view/app/view/frame.ts` by the node-tier assertions there; what this
 *  page adds is a real browser enforcing it. */
function chromeHtml(): string {
  return `<!doctype html><html><head><title>Owner view</title></head><body>
<header>chrome</header>
<iframe id="report" title="report" src="/${SLUG}"
  sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
  allow="fullscreen"></iframe>
</body></html>`;
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    seen.push({
      path,
      cookie: req.headers.cookie,
      dest: req.headers["sec-fetch-dest"] as string | undefined,
    });

    // The REAL header builders, not restatements of them.
    const headers =
      path === `/${SLUG}/view`
        ? editViewHeaders({ appOrigin: "http://127.0.0.1:1" })
        : viewHeaders();
    for (const [k, v] of headers) res.setHeader(k, v);
    // `Headers` folds duplicate CSP values into one comma-joined string on
    // iteration; browsers treat comma-separated policies as separate policies,
    // so the enforcing + sandbox pair survives intact.
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");

    if (path === `/${SLUG}/view`) {
      // The hand-off: the chrome page issues the report-scoped unlock cookie
      // the framed navigation will carry. `Secure` is fine on 127.0.0.1 —
      // browsers treat loopback as a secure context.
      res.setHeader(
        "set-cookie",
        `${UNLOCK}=unlock-token; Path=/${SLUG}; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      );
      res.end(chromeHtml());
      return;
    }
    if (path === `/${SLUG}`) {
      res.end(reportHtml("primary report"));
      return;
    }
    if (path === `/${OTHER_SLUG}`) {
      res.end(reportHtml("other report"));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.beforeEach(() => {
  seen = [];
});

test.describe("@owner-view-framing the framing contract, both ways", () => {
  test("a first-party view-origin page CAN frame the report, and the framed navigation carries the unlock cookie", async ({
    page,
  }) => {
    await page.goto(`${origin}/${SLUG}/view`);

    // Half one: the frame actually loaded. `frame-ancestors 'self'` permits a
    // same-origin embedder — this is the property ADR-0088 was bought for, and
    // the reason the owner view can exist at all.
    const frame = page.frameLocator("#report");
    await expect(frame.locator("#label")).toHaveText("primary report");

    // ...and it was a REAL navigation that carried the report-scoped cookie.
    // No token in the `src` does the work here; `Path=/<slug>` + `SameSite=Lax`
    // on a same-site subresource navigation does.
    const framed = seen.find((r) => r.path === `/${SLUG}` && r.dest === "iframe");
    expect(framed, "the report was fetched as an iframe").toBeTruthy();
    expect(framed?.cookie).toContain(`${UNLOCK}=unlock-token`);
  });

  test("the framed report runs in an OPAQUE origin — it can reach neither cookies nor the chrome", async ({
    page,
  }) => {
    await page.goto(`${origin}/${SLUG}/view`);
    const frame = page.frameLocator("#report");

    // The spike's Q1 finding, made a regression test. Withholding
    // `allow-same-origin` is what buys both of these; granting it would hand a
    // report served from this origin the run of the chrome page.
    await expect(frame.locator("#probe")).toHaveText("cookie:threw parent:threw");
  });

  test("a sandboxed report CANNOT frame another report, and no unlock cookie goes with the attempt", async ({
    page,
  }) => {
    await page.goto(`${origin}/${SLUG}/view`);
    await expect(page.frameLocator("#report").locator("#label")).toHaveText("primary report");

    // Half two. The report is in an opaque origin, so it is NOT `'self'` for
    // `frame-ancestors` purposes: its own attempt to iframe a sibling report
    // is refused. Chromium reports a blocked frame as an empty document, so
    // the nested frame never gets a body from us.
    const nested = page.frameLocator("#report").frameLocator("#nested");
    await expect(nested.locator("#label")).toHaveCount(0);

    // And independently of the CSP: the navigation carries no unlock cookie.
    // `SameSite=Lax` does not travel with a request initiated from an opaque
    // origin, so a passphrase-gated report is refused a second time on its own
    // merits. Belt and braces, deliberately — ADR-0088 rests on the CSP, and
    // this is the independent second answer.
    //
    // Asserting the request HAPPENED first is what keeps the cookie assertion
    // from passing vacuously: "no request was made" and "a request was made
    // without the cookie" are different facts, and only the second one is
    // evidence about cookies. If Chromium ever stops issuing the request at
    // all, this line fails and tells us the second answer went untested rather
    // than silently going green.
    const nestedRequest = seen.find((r) => r.path === `/${OTHER_SLUG}`);
    expect(nestedRequest, "the blocked frame still issued its request").toBeTruthy();
    expect(nestedRequest?.cookie ?? "").not.toContain(UNLOCK);
  });

  test("the chrome page and the report it frames are UNIFORMLY origin-keyed", async ({ page }) => {
    // The spike's surprise (a): Chromium warned when the chrome page was
    // site-keyed while the framed report asked for origin-keying. Both header
    // profiles must send it, which is exactly why the owner view reuses
    // ADR-0063's authenticated profile rather than inventing a third.
    const chrome = await page.goto(`${origin}/${SLUG}/view`);
    expect(chrome?.headers()["origin-agent-cluster"]).toBe("?1");

    const report = await page.goto(`${origin}/${SLUG}`);
    expect(report?.headers()["origin-agent-cluster"]).toBe("?1");
  });
});
