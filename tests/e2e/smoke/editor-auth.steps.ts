import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type APIResponse, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { mintTestSession, type TestSession } from "../support/clerk-session";

const { Given, When, Then } = createBdd();

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
