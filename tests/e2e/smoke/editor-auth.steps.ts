import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, type APIResponse, expect, test } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { mintTestSession, type TestSession } from "../support/clerk-session";
import { followToTerminal } from "../support/follow";

const { Given, When, Then } = createBdd();

// Cross-origin editor-render half (see editor-auth.feature's doc comment).
// Only set when preview-isolation.yml's `redeploy` job captured a live VIEW
// preview URL and threaded it through e2e.yml — absent on a plain local
// `pnpm e2e` run. Read once at module load, same style as playwright.config.ts's
// hasAuthCreds/hasBrowserCreds (computed once from process.env, not re-read
// per step).
const VIEW_BASE_URL = process.env.PLAYWRIGHT_VIEW_BASE_URL;

// The per-PR scan-drain secret (ADR-0045 / ADR-0080), derived identically by
// e2e.yml and preview-isolation.yml. Cloudflare's cron Worker only targets
// PROD, so on a preview NOTHING promotes an upload past `scan_status: pending`
// — and an unservable report can only ever redirect off `/edit`. Driving the
// drain from the test is what lets the scenario follow the 303 to the hop where
// both production incidents (#188 and the ADR-0080 owner lockout) actually
// happened. Absent (a plain local `pnpm e2e`) → the second-hop steps skip
// cleanly, exactly like VIEW_BASE_URL above.
const SCAN_DRAIN_SECRET = process.env.E2E_SCAN_DRAIN_SECRET;

// Module state — workers: 1 makes this safe (see playwright.config.ts). Distinct
// step phrasing from the other smoke files so the global registry has no clashes.
let session: TestSession;
let slug: string;
let response: APIResponse;
/** The `arp_edit` (and, post-#247, `arp_edit_oa`) cookies the 303 handed back —
 *  the credential the SECOND hop carries. */
let editCookieHeader: string;

// The REAL ai-readiness-report.html fixture (also exercised by
// packages/report-html/src/shell.test.ts) — a genuine presentation shell
// (`:root { --bg: #0b0f17; … }`) and `.chip` elements, kept as the upload
// fixture even though this scenario no longer asserts on its styling (see the
// TODO in editor-auth.feature) so a future re-expansion of this scenario back
// into the view-app editor's own SSR/hydration coverage can reuse it as-is.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../packages/report-html/src/fixtures/ai-readiness-report.html",
);
const FIXTURE_HTML = readFileSync(FIXTURE_PATH, "utf-8");

Given("a report I own exists", async ({ request }) => {
  // Same primary fixture user (E2E_TEST_USER_EMAIL) as the browser session
  // established by tests/e2e/support/clerk-auth.setup.ts — minting a session
  // here (Bearer, machine path) rather than reusing the browser's cookies
  // means this upload doesn't depend on the browser project at all, and it
  // provisions the SAME actor's identity mirror the editor loader resolves.
  session = await mintTestSession();

  const uploadResponse = await request.post("/api/v1/reports", {
    headers: { Authorization: `Bearer ${session.jwt}` },
    multipart: {
      file: {
        name: "ai-readiness-report.html",
        mimeType: "text/html",
        buffer: Buffer.from(FIXTURE_HTML, "utf8"),
      },
    },
  });
  const body = (await uploadResponse.json()) as Record<string, unknown>;
  expect(uploadResponse.status(), JSON.stringify(body)).toBe(201);
  expect(typeof body.slug).toBe("string");
  slug = body.slug as string;
});

// `page.request` (not `page.goto`) shares the authenticated page's cookies
// but doesn't navigate anywhere — we only need the redirect Location, not a
// real render of whatever's at the other end (see the feature file's TODO).
When("I open that report", async ({ page }) => {
  response = await page.request.get(`/reports/${slug}/open`, { maxRedirects: 0 });
});

Then("I am not redirected to sign-in", async () => {
  const location = response.headers().location ?? "";
  expect(location).not.toContain("/sign-in");
});

Then("I am redirected to an edit-shaped location for that report", async () => {
  const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
  const location = response.headers().location ?? "";
  expect(
    REDIRECT_CODES.has(response.status()),
    `expected a redirect; got status ${response.status()}, location "${location}"`,
  ).toBe(true);
  // ownerOpenLocation (open-report.server.ts) mints a scope:"edit" token and
  // redirects to `${viewOrigin}/${slug}/edit?et=<token>` for any canWrite
  // user — owner or write-grantee, no distinction since Phase 5.
  expect(location).toContain(`/${slug}/edit`);
  expect(location).toContain("et=");
});

// The cross-origin half (editor-auth.feature's doc comment): on a preview,
// `location` above is ALREADY broken as a navigation target — `viewOrigin`
// fell back to the APP's own request origin (container.server.ts), since
// VIEW_ORIGIN is prod-only. We don't navigate there. Instead we lift the
// `et=` token out of it (it's a real, valid, freshly-minted edit token
// regardless of which origin the app thought it was building a URL for) and
// navigate straight to the deployed VIEW preview's own URL, captured by
// preview-isolation.yml's `redeploy` job and threaded through e2e.yml as
// PLAYWRIGHT_VIEW_BASE_URL.
Then(
  "the view edit route accepts the edit token instead of falling back to the public viewer",
  async ({ page }) => {
    // Mirrors playwright.config.ts's hasAuthCreds/hasBrowserCreds gating style:
    // a missing precondition skips this half cleanly rather than failing on an
    // env this run was never given (local `pnpm e2e`, or any invocation of
    // e2e.yml that didn't thread a view_base_url). test.skip(condition, …)
    // called mid-test stops execution immediately, same as an eager skip.
    test.skip(
      !VIEW_BASE_URL,
      "PLAYWRIGHT_VIEW_BASE_URL not set — cross-origin view hand-off not exercised",
    );

    // location is absolute (`${someOrigin}/${slug}/edit?et=...`) even when
    // someOrigin is wrong for navigation purposes — new URL() only needs it to
    // pull the et= param back out.
    const location = response.headers().location ?? "";
    const token = new URL(location).searchParams.get("et");
    expect(token, `expected an et= token in Location "${location}"`).toBeTruthy();

    // Hit the REAL view-origin /edit with the freshly-minted edit token, no
    // redirect following. `page.request` carries the context's Vercel
    // deployment-protection bypass header (playwright.config.ts) and needs no
    // Clerk session — the view origin is credential-free, the token IS the proof.
    const res = await page.request.get(
      `${VIEW_BASE_URL}/${slug}/edit?et=${encodeURIComponent(token as string)}`,
      { maxRedirects: 0 },
    );
    const loc = res.headers().location ?? "";

    // The de-nested /edit LOADER ran and ACCEPTED the token: `resolveEditAccess`
    // returns "set-cookie" → a 303 to the clean `/${slug}/edit` URL, dropping the
    // `?et=` and setting the `arp_edit` cookie. The #188 P0 (the /edit route
    // nested UNDER the public viewer) would instead run `$slug.tsx`'s loader
    // FIRST → a one-hop 302 to `${appOrigin}/unlock/${slug}`. This assertion is
    // therefore the direct guard for that routing regression, and it also
    // exercises the cross-origin token round-trip (the app preview mints, the
    // view preview verifies with the shared VIEW_ACCESS_TOKEN_SECRET), so a real
    // secret misalignment fails here too.
    expect(
      res.status(),
      `expected the /edit loader's set-cookie 303, got ${res.status()} → "${loc}" — a 302 to /unlock means the /edit route re-nested under the public viewer (the #188 P0)`,
    ).toBe(303);
    expect(loc).toContain(`/${slug}/edit`);
    expect(loc).not.toContain("/unlock");
    // `headersArray()` already yields ONE entry per Set-Cookie, so take the
    // `name=value` pair off the front of each. (The previous version joined
    // them with "; " and then tried to split them apart again on a COMMA that
    // by then did not exist — so the split found a single element, kept the
    // text before its first ";", and silently dropped `arp_edit_oa`. The gate
    // then saw no owner fallback and correctly emitted a bare read-only link,
    // which read as a product bug.)
    const setCookiePairs = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value.split(";")[0]?.trim() ?? "")
      .filter(Boolean);

    // Assert BOTH by their `name=` prefix: `arp_edit` is a substring of
    // `arp_edit_oa`, so a bare `toContain("arp_edit")` passes on either one
    // alone — which is exactly how the missing cookie stayed invisible.
    expect(
      setCookiePairs.some((c) => c.startsWith("arp_edit=")),
      `the 303 must mint the edit cookie; got ${JSON.stringify(setCookiePairs)}`,
    ).toBe(true);
    expect(
      setCookiePairs.some((c) => c.startsWith("arp_edit_oa=")),
      `an OWNER's 303 must also persist the owner fallback (ADR-0063 Phase 5-G) — without it every later degrade strands the owner; got ${JSON.stringify(setCookiePairs)}`,
    ).toBe(true);

    // Carried to the SECOND hop below — the request that actually decides
    // whether the editor opens, and the one both production incidents happened
    // on. `Set-Cookie` values are `name=value; Path=…; HttpOnly; …`; the cookie
    // header wants just the `name=value` pairs.
    editCookieHeader = setCookiePairs.join("; ");
  },
);

// ── The scan drain: what makes a preview's upload SERVABLE ──────────────────
//
// `POST /internal/scan-drain` is the async scan worker's HTTP trigger
// (ADR-0045). In production a Cloudflare Cron Trigger calls it every ~minute;
// on a preview nothing does, which is why an uploaded report sits at
// `scan_status: pending` forever and `/edit` can only redirect. The route is
// fail-closed: 503 when the secret is unset, 401 on a mismatch — so a broken
// wiring is loud, never a silent skip.
async function drainUntilClean(api: APIRequestContext, targetSlug: string): Promise<void> {
  const auth = { Authorization: `Bearer ${session.jwt}` };
  // Bounded: the drain claims a batch per tick and the stub scanner promotes
  // synchronously, so one tick normally suffices. A few more cover a cold
  // Neon branch and pg-boss's own first-run bootstrap.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const drained = await api.post("/internal/scan-drain", {
      headers: { Authorization: `Bearer ${SCAN_DRAIN_SECRET}` },
    });
    expect(
      drained.status(),
      `POST /internal/scan-drain answered ${drained.status()} — 503 means SCAN_DRAIN_SECRET is unset on the preview, 401 means e2e.yml and preview-isolation.yml derived DIFFERENT values (they must stay byte-identical)`,
    ).toBe(200);

    const versions = await api.get(`/api/v1/reports/${targetSlug}/versions`, { headers: auth });
    expect(versions.status()).toBe(200);
    const body = (await versions.json()) as { data?: { scan_status?: string }[] };
    if (body.data?.[0]?.scan_status === "clean") return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(
    `report ${targetSlug} never reached scan_status: clean after 10 drain ticks — the scan pipeline, not the editor, is what failed here`,
  );
}

Given("that report has been scanned clean", async ({ page }) => {
  test.skip(
    !SCAN_DRAIN_SECRET,
    "E2E_SCAN_DRAIN_SECRET not set — the scan drain cannot be driven, so the report never becomes servable",
  );
  await drainUntilClean(page.request, slug);
});

// THE HOP THAT MATTERED. Every step of BOTH production incidents happened here:
// the request AFTER the 303, carrying the `arp_edit` cookie. #188 was the
// /edit route re-nesting under the public viewer; the ADR-0080 lockout was the
// owner-access fallback dying at this exact boundary. Both showed up as a 302
// off `/edit` — the one status this step exists to reject.
Then("the cookie-carrying request opens the editor instead of redirecting", async ({ page }) => {
  test.skip(!VIEW_BASE_URL, "PLAYWRIGHT_VIEW_BASE_URL not set — no view origin to follow to");
  test.skip(!SCAN_DRAIN_SECRET, "E2E_SCAN_DRAIN_SECRET not set — report is not servable");

  // TERMINAL, not the first answer. `followToTerminal` walks wherever this
  // request goes — carrying the `arp_edit` cookie forward across every hop —
  // so a regression that bounces the owner somewhere else is measured at its
  // DESTINATION rather than at the bounce. Today the chain is one hop long and
  // the `hops` assertion below pins that; if it ever grows, the status and body
  // assertions still describe what the owner actually gets, instead of silently
  // passing on the redirect's own 3xx.
  const terminal = await followToTerminal(page.request, `${VIEW_BASE_URL}/${slug}/edit`, {
    headers: { Cookie: editCookieHeader },
  });
  const chain = terminal.hops.map((h) => `${h.status} ${h.url}`).join(" → ");

  expect(
    terminal.hops,
    `the cookie-carrying /edit request must be answered directly, with no redirect at all; got ${chain}`,
  ).toHaveLength(1);
  expect(
    terminal.status,
    `expected 200 from the cookie-carrying /edit request; got ${chain}. A 302 here is the owner-lockout shape (ADR-0080): the gate accepted the token on hop 1 and refused the cookie on hop 2, or the document could not be opened. A 5xx is worse — the loader crashed where it is contracted never to.`,
  ).toBe(200);

  // AND THE BODY, because a 200 alone was not enough. `redirectToPublicViewer`
  // is not the only way this route can fail an owner: the public viewer, the
  // unopenable-document page and the editor all answer 2xx-or-4xx HTML, and
  // only one of them is the editor. `data-testid="unified-editor"` is rendered
  // by the "render" decision branch alone ($slug_.edit.tsx) — every degrade
  // branch returns markup without it — so this is the assertion that says the
  // owner got an EDITOR rather than merely a page.
  expect(
    terminal.body,
    `the terminal response must be the mounted editor (data-testid="unified-editor"); got ${terminal.body.length} bytes from ${terminal.url}`,
  ).toContain('data-testid="unified-editor"');
  expect(terminal.body).not.toContain("/unlock/");
});

// ── The negative: a report the editor CANNOT open ───────────────────────────
Given("a report I own that the editor cannot open exists", async ({ request }) => {
  session = await mintTestSession();
  // A bare fragment — no <body> — which is a perfectly ordinary thing for an
  // agent to upload, views fine, and defeats `splitShell` (ADR-0080).
  const uploadResponse = await request.post("/api/v1/reports", {
    headers: { Authorization: `Bearer ${session.jwt}` },
    multipart: {
      file: {
        name: "fragment.html",
        mimeType: "text/html",
        buffer: Buffer.from("<h1>Findings</h1><p>An HTML fragment, not a document.</p>", "utf8"),
      },
    },
  });
  const body = (await uploadResponse.json()) as Record<string, unknown>;
  expect(uploadResponse.status(), JSON.stringify(body)).toBe(201);
  slug = body.slug as string;

  // ADR-0080's own contract, asserted against real infrastructure: the upload
  // is ACCEPTED (201 above), and the response itself tells the uploader — an
  // agent, on the product's primary write surface — that it is not editable.
  expect(
    body.editability,
    "the upload response must name the editability verdict for the bytes just stored",
  ).toBe("unsplittable");
});

Then("the report reads back as un-editable over the API", async ({ page }) => {
  const res = await page.request.get(`/api/v1/reports/${slug}`, {
    headers: { Authorization: `Bearer ${session.jwt}` },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { editability?: unknown; is_published?: unknown };
  // The LIVE version's verdict — which is only populated once the scan promoted
  // it, so this also proves the recorded value survives the round-trip through
  // Postgres rather than living only in the upload response.
  expect(body.is_published).toBe(true);
  expect(body.editability).toBe("unsplittable");
});

Then("the view edit route degrades to a read-only view instead of failing", async ({ page }) => {
  test.skip(!VIEW_BASE_URL, "PLAYWRIGHT_VIEW_BASE_URL not set — no view origin to follow to");
  test.skip(!SCAN_DRAIN_SECRET, "E2E_SCAN_DRAIN_SECRET not set — report is not servable");

  const terminal = await followToTerminal(page.request, `${VIEW_BASE_URL}/${slug}/edit`, {
    headers: { Cookie: editCookieHeader },
  });
  const chain = terminal.hops.map((h) => `${h.status} ${h.url}`).join(" → ");

  // THE POINT: an un-editable document must be EXPLAINED, not crash and not
  // vanish. PR #247 landed the contract this step was written against and
  // improved on it: rather than a silent 302 into an unexplained read-only
  // viewer, the route renders its own page naming the reason. 409 — not 200
  // (which would tell every probe and log query that editing worked) and not
  // 3xx (the silent bounce that made the original incident invisible).
  //
  // Followed to the TERMINAL state so that "it silently bounced" is measured
  // rather than inferred: were the route to start redirecting again, the hops
  // assertion names the whole chain instead of failing on an opaque 302.
  const body = terminal.body;
  expect(
    terminal.hops,
    `the unopenable-document page must be served directly, with no redirect; got ${chain}`,
  ).toHaveLength(1);
  expect(
    terminal.status,
    `expected the unopenable-document page, got ${chain} — a 5xx means the /edit loader crashed on a document it is contracted to degrade on, a 3xx means it silently bounced`,
  ).toBe(409);

  // The capability was already verified (the gate returned `serve` for a valid
  // arp_edit cookie), so this page is the route's own first-party document —
  // it must name WHY and offer the read-only route out.
  // NB: the shipped copy uses a TYPOGRAPHIC apostrophe (can’t). Matching a
  // straight one here would never fire and the assertion would be decorative.
  expect(body, "the page must say the editor could not open this report").toMatch(
    /can[’']t be opened in the editor/i,
  );
  expect(body, "the page must name the fragment cause — this fixture has no <body>").toMatch(
    /fragment/i,
  );
  expect(body, "the page must offer the read-only view").toContain(`/${slug}`);

  // …and that offer must actually WORK. The bare `/{slug}` this page shipped
  // with was measured in production on f83ed59: for a PRIVATE report it lands
  // on the public viewer → `${appOrigin}/unlock/{slug}` → "Open this report" →
  // `/reports/{slug}/open` → `/edit` → this page again. A cycle whose every hop
  // is an improvement and whose net effect is that the OWNER of a private,
  // unopenable report cannot read it at all. The `arp_edit_oa` cookie carried
  // above IS the owner fallback, already verified by the gate, so the link must
  // carry it as `?access=`.
  expect(
    body,
    "the read-only link must carry the verified owner fallback — a bare /{slug} sends a private report's owner to the unlock wall and back here, forever",
  ).toContain(`/${slug}?access=`);
});
