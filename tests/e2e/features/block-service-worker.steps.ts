// Step definitions for block-service-worker.feature (ADR-0014).
//
// The narrative and the reason this is an e2e rather than a unit test are in
// the feature file's own preamble. What matters here: every assertion is about
// OUR middleware's own Response — the refusal body it writes and the
// `x-edge-marker` it sets — never a bare status, because Vercel Deployment
// Protection answers 4xx for its own reasons on a preview and a status-only
// check would pass on a deployment where the edge never ran.
import { type APIResponse, expect, test } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { When, Then } = createBdd();

// The isolated VIEW preview's own URL, threaded through e2e.yml by
// preview-isolation.yml. Read once at module load, same as editor-auth.steps.ts.
// Absent on a plain local `pnpm e2e` → the view-origin scenario skips, which is
// correct locally and FAILS THE JOB in CI (tests/e2e/support/skip-guard.ts),
// where preview-isolation.yml always produces it.
const VIEW_BASE_URL = process.env.PLAYWRIGHT_VIEW_BASE_URL;

/** The literal body both middlewares answer with. */
const REFUSAL = "Service workers are not allowed on this origin.";

// Module state — `workers: 1` makes this safe (see playwright.config.ts).
// Distinct step phrasing from every other steps file so the global registry has
// no duplicate definitions.
let response: APIResponse;

When(
  "the view origin is asked for {string} with a service-worker script header",
  async ({ page }, path: string) => {
    test.skip(!VIEW_BASE_URL, "PLAYWRIGHT_VIEW_BASE_URL not set — no view origin to probe");
    response = await page.request.get(`${VIEW_BASE_URL}${path}`, {
      headers: { "Service-Worker": "script" },
      maxRedirects: 0,
    });
  },
);

When(
  "the app origin is asked for {string} with a service-worker script header",
  async ({ request }, path: string) => {
    response = await request.get(path, {
      headers: { "Service-Worker": "script" },
      maxRedirects: 0,
    });
  },
);

When(
  "the app origin is asked for {string} with no service-worker header",
  async ({ request }, path: string) => {
    response = await request.get(path, { maxRedirects: 0 });
  },
);

Then("the edge itself refuses it with marker {string}", async ({}, marker: string) => {
  const body = await response.text();
  expect(
    response.status(),
    `expected the edge middleware's own 403; got ${response.status()} with body ${JSON.stringify(body.slice(0, 200))}`,
  ).toBe(403);
  // Status alone is not enough (Deployment Protection also 4xxs), and neither
  // signal alone is: the body could in principle be echoed by something else,
  // and the marker distinguishes WHICH origin's middleware answered. Together
  // they can only come from apps/{app,view}/middleware.ts executing at the
  // edge, on this origin, for this request.
  expect(body).toContain(REFUSAL);
  expect(
    response.headers()["x-edge-marker"],
    "the middleware sets x-edge-marker on its own refusal Response — its absence means something OTHER than our edge answered",
  ).toBe(marker);
});

Then("it is served normally, not refused as a service worker", async () => {
  // The negative half. A middleware that refused every request would satisfy
  // both positive scenarios while breaking the product, so this asserts the
  // refusal specifically did NOT happen — not merely that some 2xx came back.
  const body = await response.text();
  expect(
    response.status(),
    `expected the ordinary request to be served; got ${response.status()}`,
  ).toBe(200);
  expect(body).not.toContain(REFUSAL);
  expect(response.headers()["x-edge-marker"]).not.toBe("app-mw-sw-blocked");
});
