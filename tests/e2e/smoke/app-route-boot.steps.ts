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

// Assert the ACTUAL outcome: an unauthenticated GET to this /api/v1 route answers
// 401 application/problem+json (handle()'s resolveActorForRead gate,
// apps/app/app/server/handle.server.ts -> packages/http/src/problem.ts's
// errorToHttp, runs BEFORE the slug/query-param/report-html code). Reaching
// that 401 requires importing the route module — including `arp-report-html`
// at module scope via report-diff-loader.server.ts's `splitShell` — so a
// clean, correctly-shaped 401 proves the whole server graph resolved and
// booted. A boot crash of the #163/#167 class 500s instead -> fails here.
//
// Why not a broad "any non-5xx" allowlist (claude-review #169): Vercel Deployment
// Protection returns **401** for a DIFFERENT reason when the bypass secret is
// missing/rotated (a platform-layer 401, not our app's), and the platform can
// also return **404** — both WITHOUT the app ever booting. A boot crash + missing
// bypass could then coincidentally 401 too, so a bare "status === 401" check isn't
// enough on its own — requiring OUR problem+json body shape (`code:
// "unauthenticated"`, the exact wire shape `errorToHttp`/`problemFor` in
// packages/http/src/problem.ts produces) can only come from our app's own auth
// gate actually running, so it stays auth-session-free while rejecting
// platform-layer responses.
Then("the app did not crash booting that route", async () => {
  const status = response.status();
  const body = (await response.json().catch(() => null)) as { code?: string } | null;
  expect(
    status === 401 && body?.code === "unauthenticated",
    `expected our app's own 401 problem+json with code "unauthenticated" (proves the app booted); got status ${status}, body ${JSON.stringify(body)}`,
  ).toBe(true);
});
