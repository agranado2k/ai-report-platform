import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type APIResponse, expect, test } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { mintTestSession, type TestSession } from "../support/clerk-session";

const { Given, When, Then } = createBdd();

// Cross-origin editor-render half (see editor-auth.feature's doc comment).
// Only set when preview-isolation.yml's `redeploy` job captured a live VIEW
// preview URL and threaded it through e2e.yml — absent on a plain local
// `pnpm e2e` run. Read once at module load, same style as playwright.config.ts's
// hasAuthCreds/hasBrowserCreds (computed once from process.env, not re-read
// per step).
const VIEW_BASE_URL = process.env.PLAYWRIGHT_VIEW_BASE_URL;

// Module state — workers: 1 makes this safe (see playwright.config.ts). Distinct
// step phrasing from the other smoke files so the global registry has no clashes.
let session: TestSession;
let slug: string;
let response: APIResponse;

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
Then("the unified editor actually renders at the view origin", async ({ page }) => {
  // Mirrors playwright.config.ts's hasAuthCreds/hasBrowserCreds gating style:
  // a missing precondition skips this half cleanly rather than failing on an
  // env this run was never given (local `pnpm e2e`, or any invocation of
  // e2e.yml that didn't thread a view_base_url). test.skip(condition, …)
  // called mid-test stops execution immediately, same as an eager skip.
  test.skip(
    !VIEW_BASE_URL,
    "PLAYWRIGHT_VIEW_BASE_URL not set — cross-origin view render not exercised",
  );

  // location is absolute (`${someOrigin}/${slug}/edit?et=...`) even when
  // someOrigin is wrong for navigation purposes — new URL() only needs it to
  // pull the et= param back out.
  const location = response.headers().location ?? "";
  const redirectUrl = new URL(location);
  const token = redirectUrl.searchParams.get("et");
  expect(token, `expected an et= token in Location "${location}"`).toBeTruthy();

  await page.goto(`${VIEW_BASE_URL}/${slug}/edit?et=${encodeURIComponent(token as string)}`);

  // The ONLY element the "render" decision kind ever emits (see
  // apps/view/app/routes/$slug.edit.tsx's data-testid comment) — every
  // "can't/shouldn't render the editor" branch degrades to the public viewer
  // instead, which never renders this. Its presence alone proves the et=
  // token round-trip validated AND APP_ORIGIN was wired, i.e. the exact
  // regression class (owner-lockout via a broken edit-token hand-off) that
  // shipped uncaught before this scenario existed.
  await expect(page.getByTestId("unified-editor")).toBeVisible();

  // Belt-and-braces: confirm we did NOT degrade to the public viewer/unlock
  // flow (degradeLocation, apps/view/app/server/edit-session.ts returns
  // `/${slug}` or `/${slug}?access=...` — never `/edit` — on every degrade
  // path, and a denied decision with no owner fallback lands on /unlock).
  const landedUrl = page.url();
  expect(landedUrl).toContain(`/${slug}/edit`);
  expect(landedUrl).not.toContain("/unlock");
});
