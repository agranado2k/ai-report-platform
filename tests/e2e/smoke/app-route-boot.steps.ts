import { type APIResponse, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { When, Then } = createBdd();

// Regression guard for the #163/#167 PROD-DOWN incident (issue #166) — the full
// incident writeup lives as a comment in app-route-boot.feature. Module state is
// safe under workers: 1 (see playwright.config.ts). Distinct step phrasing from
// the other smoke files so the global step registry has no duplicate definitions.
let response: APIResponse;

When("I GET the report-html-importing app route {string}", async ({ request }, path: string) => {
  response = await request.get(path, { maxRedirects: 0 });
});

// Assert the ACTUAL outcome: an unauthenticated GET is redirected to /sign-in
// (root.tsx's rootAuthLoader + the loader's own redirect). Reaching that redirect
// requires importing the route module — including `arp-report-html` at module
// scope — so a 302→/sign-in proves the whole server graph resolved and booted. A
// boot crash of the #163/#167 class 500s instead → fails here.
//
// Why not a broad "any non-5xx" allowlist (claude-review #169): Vercel Deployment
// Protection returns **401** when the bypass secret is missing/rotated, and the
// platform can return **404** — both WITHOUT the app ever booting. A boot crash +
// missing bypass would then 401 and a permissive allowlist would false-PASS, the
// exact class this guard exists to close. Requiring a redirect whose Location
// points at /sign-in can only come from our app's auth gate, so it stays
// auth-session-free while rejecting platform-layer responses.
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

Then("the app did not crash booting that route", async () => {
  const status = response.status();
  const location = response.headers().location ?? "";
  expect(
    REDIRECT_CODES.has(status) && location.includes("/sign-in"),
    `expected an auth redirect to /sign-in (proves the app booted); got status ${status}, location "${location}"`,
  ).toBe(true);
});
