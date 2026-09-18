import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { createBdd } from "playwright-bdd";
// THE SHIPPED CONSTANTS, imported rather than restated — the house rule from
// `tests/browser/owner-view-framing.spec.ts`, reached by path the same way
// (this tier is not a workspace package and has no dependency on `apps/view`).
//
// Restating the token sets here would be the "typed it twice" failure ADR-0088
// names: a test that restates the policy proves only that someone typed it
// twice, and its drift from the product would be SILENT. The ADR ↔ constant
// link is already pinned, literally and negatively, by
// `apps/view/app/view/frame.test.ts` (which asserts the exact token set, and
// asserts `allow-same-origin` and `allow-top-navigation` are ABSENT). What that
// unit test cannot see is whether the DEPLOYED page puts those constants on a
// real attribute — which is exactly and only what this step adds.
import { REPORT_FRAME_ALLOW, REPORT_FRAME_SANDBOX } from "../../../apps/view/app/view/frame";
import { mintTestSession, type TestSession } from "../support/clerk-session";
import { drainUntilClean } from "../support/scan-drain";

const { Given, When, Then } = createBdd();

/** The deployed VIEW preview's own origin, captured by preview-isolation.yml's
 *  `redeploy` job and threaded through e2e.yml. Absent on a plain local
 *  `pnpm e2e`. Read once at module load, the same style as
 *  `editor-auth.steps.ts` and `playwright.config.ts`. */
const VIEW_BASE_URL = process.env.PLAYWRIGHT_VIEW_BASE_URL;

/** The per-PR scan-drain secret (ADR-0045). Without it a preview's upload never
 *  leaves `scan_status: pending`, so the framed `GET /<slug>` could only ever
 *  redirect and the deck would never render. See `../support/scan-drain`. */
const SCAN_DRAIN_SECRET = process.env.E2E_SCAN_DRAIN_SECRET;

/** The Google Fonts stylesheet host — the one directly observable consequence
 *  of ADR-0088's artifact-parity allowlist (`style-src … https://fonts.googleapis.com`). */
const FONTS_STYLESHEET_HOST = "https://fonts.googleapis.com/";

// Module state — `workers: 1` makes this safe (see playwright.config.ts).
let session: TestSession;
let slug: string;

/** Every attempt the BROWSER made at the Google Fonts stylesheet, and how each
 *  one ended. Populated from the moment before the owner view is navigated to,
 *  so the framed report's own subresource fetch is captured (page-level request
 *  events cover every frame, including a sandboxed one in an opaque origin). */
interface FontAttempt {
  readonly url: string;
  readonly status: number | null;
  readonly failure: string | null;
}
let fontAttempts: FontAttempt[] = [];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/owner-view-deck.html");
const FIXTURE_TEMPLATE = readFileSync(FIXTURE_PATH, "utf-8");

Given("a private script-driven deck I own is published", async ({ page }) => {
  test.skip(
    !SCAN_DRAIN_SECRET,
    "E2E_SCAN_DRAIN_SECRET not set — the deck can never become servable, so it cannot be framed",
  );

  // The SAME primary fixture user (E2E_TEST_USER_EMAIL) the browser session was
  // established for (`../support/clerk-auth.setup.ts`). Uploading over Bearer
  // rather than through the dashboard form keeps this step independent of the
  // upload UI — the surface under test is the owner VIEW, and a broken upload
  // page should not read as a broken deck.
  session = await mintTestSession();

  // The nonce is why every run really uploads rather than replaying: see the
  // fixture's own header, and `editor-auth.steps.ts`'s `randomUUID()` note.
  const html = FIXTURE_TEMPLATE.replace("__E2E_NONCE__", randomUUID());

  const uploadResponse = await page.request.post("/api/v1/reports", {
    headers: { Authorization: `Bearer ${session.jwt}` },
    multipart: {
      file: {
        name: "owner-view-deck.html",
        mimeType: "text/html",
        buffer: Buffer.from(html, "utf8"),
      },
    },
  });
  const body = (await uploadResponse.json()) as Record<string, unknown>;
  expect(uploadResponse.status(), JSON.stringify(body)).toBe(201);
  expect(typeof body.slug).toBe("string");
  slug = body.slug as string;

  // PRIVATE, and asserted rather than assumed. Private-by-default is ADR-0075,
  // but this scenario's whole cookie story (ADR-0089 §4c: the 303 must plant
  // `arp_unlock` at `Path=/<slug>` or the frame shows the unlock wall) is only
  // under test while the report is actually gated. Were the default ever to
  // flip to public, the deck would still advance and this scenario would go on
  // passing while silently proving something much weaker.
  const acl = await page.request.get(`/api/v1/reports/${slug}/acl`, {
    headers: { Authorization: `Bearer ${session.jwt}` },
  });
  expect(acl.status()).toBe(200);
  const aclBody = (await acl.json()) as { mode?: unknown };
  expect(
    aclBody.mode,
    "the deck must be PRIVATE — a public report's frame would serve without the arp_unlock hand-off, so the scenario would stop testing ADR-0089 §4c",
  ).toBe("private");

  await drainUntilClean(page.request, slug, {
    drainSecret: SCAN_DRAIN_SECRET,
    jwt: session.jwt,
  });
});

When("I open that deck from the dashboard", async ({ page }) => {
  test.skip(!VIEW_BASE_URL, "PLAYWRIGHT_VIEW_BASE_URL not set — no deployed view origin to open");

  // (1) THE REAL DASHBOARD ROW. `?q=` is a literal title/slug substring filter
  // (report-repository.ts), so scoping to this slug makes the row findable
  // regardless of how many reports the reused per-PR Neon branch has
  // accumulated — the dashboard is cursor-paginated (ADR-0053) and an
  // unfiltered load would put a fresh report's row wherever the page boundary
  // happened to fall.
  const dashboard = await page.goto(`/?q=${encodeURIComponent(slug)}`);
  expect(
    dashboard?.status(),
    "the signed-in owner must reach their own dashboard; a sign-in redirect here means the browser storageState is not authenticated",
  ).toBe(200);

  // The row's Open affordance is the stretched link in `ReportRow.tsx`. It is
  // found by the one thing that is truly this report's — its href — rather
  // than by accessible name, because the API upload path sets no title at all
  // (`uploadReport` falls back to "Untitled report"), so a name-keyed locator
  // would match every other report the reused per-PR Neon branch has
  // accumulated, or nothing. Asking for the href and then asserting the NAME
  // keeps both halves of the affordance under test, and keeps them
  // independent: the link must point at the one mint, AND it must be a real,
  // accessibly-named control rather than a bare clickable div.
  const open = page.locator(`a[href="/reports/${slug}/open"]`);
  await expect(
    open,
    `the dashboard row for ${slug} must offer exactly one Open link — this is the owner's real entry point. Zero means either the ?q= filter did not surface the row, or the report is not \`isPublished\` and so renders no overlay at all (#334).`,
  ).toHaveCount(1);
  await expect(
    open,
    'the Open overlay\'s only accessible name is its `sr-only` "Open <title>" span — an overlay that lost it is unreachable to a screen reader and to keyboard users',
  ).toHaveAccessibleName(/^Open\s+\S/);

  // (2) WHY THE CLICK IS NOT FOLLOWED. On a preview VIEW_ORIGIN is unset
  // (Terraform wires it prod-only), so `/reports/{slug}/open` builds its
  // Location from the APP's own request origin (container.server.ts) and points
  // at an app-origin URL with no route behind it. Following the click would
  // land on a 404 that says nothing about the owner view. The token in that
  // Location is nonetheless real, freshly minted and valid — so the scenario
  // lifts it out and navigates to the deployed VIEW preview instead. The exact
  // seam, and the exact reason, as `editor-auth.steps.ts`.
  const minted = await page.request.get(`/reports/${slug}/open`, { maxRedirects: 0 });
  const location = minted.headers().location ?? "";
  expect(
    [301, 302, 303, 307, 308].includes(minted.status()),
    `expected /open to redirect; got ${minted.status()} → "${location}"`,
  ).toBe(true);
  expect(location, "the owner-open flip (#363) must land on the owner view").toContain(
    `/${slug}/view`,
  );

  const params = new URL(location).searchParams;
  const editToken = params.get("et");
  const ownerAccess = params.get("oa");
  expect(editToken, `expected an et= edit token in Location "${location}"`).toBeTruthy();
  // `oa` is what becomes `arp_unlock` at `Path=/<slug>` (ADR-0089 §4c), and it
  // is therefore the reason the FRAME can fetch a private report at all. A
  // request rebuilt from `et` alone would frame the unlock wall, and the deck
  // assertions below would be measuring the harness rather than the product.
  expect(
    ownerAccess,
    `expected an oa= owner fallback in Location "${location}" — the opener IS the owner here`,
  ).toBeTruthy();

  // (3) WATCH THE NETWORK BEFORE NAVIGATING. Registered here, not in the fonts
  // step, because a subresource fetched during the load would otherwise be over
  // before anyone was listening. Page-level events see every frame, the
  // sandboxed opaque-origin one included.
  fontAttempts = [];
  page.on("response", (response) => {
    if (!response.url().startsWith(FONTS_STYLESHEET_HOST)) return;
    fontAttempts.push({ url: response.url(), status: response.status(), failure: null });
  });
  page.on("requestfailed", (request) => {
    if (!request.url().startsWith(FONTS_STYLESHEET_HOST)) return;
    fontAttempts.push({
      url: request.url(),
      status: null,
      failure: request.failure()?.errorText ?? "unknown failure",
    });
  });

  // THE REAL NAVIGATION. `?et=…&oa=…` is the full hand-off (ADR-0089 §4): the
  // route answers 303 to the clean `/<slug>/view` so no token is ever served
  // on, planting `arp_view`, `arp_view_oa` and — the one that matters here —
  // `arp_unlock` at `Path=/<slug>`. The browser follows, and the chrome page's
  // iframe then makes an ordinary same-site request for the report, carrying
  // that cookie and nothing else.
  const landed = await page.goto(
    `${VIEW_BASE_URL}/${slug}/view` +
      `?et=${encodeURIComponent(editToken as string)}` +
      `&oa=${encodeURIComponent(ownerAccess as string)}`,
  );
  expect(
    landed?.status(),
    `the owner view must serve after the hand-off; got ${landed?.status()} at ${page.url()}`,
  ).toBe(200);
  // The token left the address bar, which is the property §4 opens with.
  expect(page.url(), "no token may survive in the address bar (ADR-0089 §4)").not.toContain("et=");
  expect(page.url()).not.toContain("oa=");
});

Then("the owner view chrome is present", async ({ page }) => {
  // `data-testid="owner-view"` is rendered by `OwnerViewChrome` alone. Every
  // degrade branch of the gate redirects instead (to the funnel, or to the bare
  // `/<slug>`), so this marker is what says the owner got the CHROME rather
  // than merely a page — the same reasoning as `editor-auth`'s
  // `data-testid="unified-editor"`.
  await expect(
    page.getByTestId("owner-view"),
    "the owner view chrome must have rendered; a bare report here means the gate degraded instead of serving",
  ).toBeVisible();
});

/** The one iframe on the chrome page: the framed report (ADR-0089 §2). */
function reportFrameElement(page: Page): Locator {
  return page.locator("iframe");
}

Then("the framed report carries the owner-view iframe contract", async ({ page }) => {
  const frame = reportFrameElement(page);
  await expect(frame, "the owner view must frame exactly one document").toHaveCount(1);

  // THE CONTAINMENT, on the deployed page. Asserted as the EXACT attribute
  // values, not as "contains allow-scripts": `sandbox` is a token set where the
  // absences are the security property (ADR-0089 §2 — no `allow-same-origin`,
  // no top-navigation), and a containment check cannot see a token that was
  // ADDED. Equality can.
  await expect(
    frame,
    "the framed report's sandbox must match the shipped token set exactly — an ADDED token (allow-same-origin above all) is what a substring check would miss",
  ).toHaveAttribute("sandbox", REPORT_FRAME_SANDBOX);
  await expect(
    frame,
    '`allow="fullscreen"` is load-bearing and was verified negatively by the spike: without it requestFullscreen() throws and a deck cannot go fullscreen',
  ).toHaveAttribute("allow", REPORT_FRAME_ALLOW);

  // And the frame points at the CANONICAL report, carrying no token of its own
  // (ADR-0089 §2: a token here would land a capability in the report's own
  // `document.referrer` and in browser history).
  await expect(frame).toHaveAttribute("src", `/${slug}`);
});

/** The framed report's own document. Playwright reaches into a sandboxed,
 *  opaque-origin frame perfectly well — `tests/browser/owner-view-framing.spec.ts`
 *  relies on the same thing — which is what lets this tier ask whether the deck
 *  RAN, rather than only what bytes were served. */
function deckSlide(page: Page, testId: string): Locator {
  return page.frameLocator("iframe").getByTestId(testId);
}

When("I press the right arrow key", async ({ page }) => {
  // Slide one first, so "the deck advanced" is a transition rather than a
  // coincidence — a fixture that rendered both slides at once (the `[hidden]`
  // defect this fixture ships its own reset against) would otherwise pass the
  // assertion below without anything having advanced at all.
  await expect(
    deckSlide(page, "slide-1"),
    "the deck must start on slide one — if slide two is already visible the fixture's [hidden] reset is not applying",
  ).toBeVisible();
  await expect(deckSlide(page, "slide-2")).toBeHidden();

  // NO CLICK FIRST, deliberately. `ReportFrame` focuses the iframe on load
  // precisely so arrow keys reach the deck without one — "the single thing that
  // makes a framed deck feel broken". Clicking into the frame here would supply
  // that focus ourselves and retire the only end-to-end check of it.
  await page.keyboard.press("ArrowRight");
});

Then("the deck advances to slide two inside the frame", async ({ page }) => {
  await expect(
    deckSlide(page, "slide-2"),
    "slide two must be visible after ArrowRight — this is the whole claim of ADR-0089: allow-scripts without allow-same-origin means the report RUNS, and the frame is focused so the key reaches it",
  ).toBeVisible();
  await expect(
    deckSlide(page, "slide-1"),
    "slide one must be hidden — both slides visible means the deck's own [hidden] reset stopped applying",
  ).toBeHidden();
});

Then("the deck's Google Fonts stylesheet was fetched rather than refused by the CSP", async () => {
  // THE DISCRIMINATION. A CSP-refused subresource never becomes a network
  // request, so it produces NO request event at all; an unreachable host
  // produces a `requestfailed` carrying a network error string. Reporting those
  // two as one failure is what would let "CI has no egress" be misread as
  // "ADR-0088's allowlist regressed" — the only thing this assertion is for.
  expect(
    fontAttempts.length,
    `the framed deck's Google Fonts <link> produced NO network request at all. That is the shape of a CSP REFUSAL, not of an unreachable host: the report's own response must carry ADR-0088's artifact-parity allowlist (style-src … ${FONTS_STYLESHEET_HOST}). Check viewHeaders()'s VIEW_CSP_ALLOWLIST on the deployed /${slug}.`,
  ).toBeGreaterThan(0);

  const succeeded = fontAttempts.filter((a) => a.status !== null && a.status < 400);
  expect(
    succeeded.length,
    `the Google Fonts stylesheet request left the browser but did not succeed: ${JSON.stringify(fontAttempts)}. A failure string here (DNS/connection) points at CI egress rather than at the CSP — the request having been ATTEMPTED at all already proves the allowlist admitted it.`,
  ).toBeGreaterThan(0);
});
