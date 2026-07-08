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

// Deliberately auth-agnostic (see the feature file's comment): any status EXCEPT a
// 5xx proves the server booted and the whole route module graph — including
// arp-report-html — resolved. A boot crash of the #163/#167 class 500s on EVERY
// route, so even an auth-redirect (302) is sufficient proof; no Clerk session
// needed. The explicit allowlist (rather than a bare "< 500") documents exactly
// which outcomes this route can legitimately produce for an unauthenticated,
// possibly-nonexistent slug.
const NOT_A_BOOT_CRASH = new Set([200, 301, 302, 303, 401, 403, 404]);

Then("the app did not crash booting that route", async () => {
  const status = response.status();
  expect(NOT_A_BOOT_CRASH.has(status), `unexpected status ${status} (possible boot crash)`).toBe(
    true,
  );
});
