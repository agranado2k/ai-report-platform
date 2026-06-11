import { type APIResponse, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { When, Then } = createBdd();

// Self-contained module state — workers: 1 (see playwright.config.ts) makes this
// safe for a single smoke scenario. Distinct step phrasing from health.steps.ts
// so the global step registry has no duplicate definitions.
let response: APIResponse;
let body: Record<string, unknown>;

// A marker unique PER RUN. Two reasons: (1) it identifies THIS upload in the
// served page; (2) — critically — it keeps the upload hermetic. Previews share
// the prod DB, and an identical body derives the same idempotency key (ADR-0039),
// so fixed content would *replay* a prior run's upload (which an earlier run may
// have promoted to live) — making the "holding page" assertion flaky. Unique
// content => a fresh `pending` report every run => the viewer truly holds.
const MARKER = `arp-smoke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const HTML = `<!doctype html><html><body><h1>${MARKER}</h1></body></html>`;

When("I upload an HTML report file to {string}", async ({ request }, path: string) => {
  response = await request.post(path, {
    multipart: {
      file: { name: "report.html", mimeType: "text/html", buffer: Buffer.from(HTML, "utf8") },
    },
  });
  body = (await response.json()) as Record<string, unknown>;
});

Then("the upload response status is {int}", async ({}, status: number) => {
  expect(response.status(), JSON.stringify(body)).toBe(status);
});

Then(
  'the upload body has a "slug", a "view_url", a "version" of {int}, and "scan_status" of {string}',
  async ({}, version: number, scanStatus: string) => {
    expect(typeof body.slug).toBe("string");
    expect((body.slug as string).length).toBeGreaterThan(0);
    expect(typeof body.view_url).toBe("string");
    // Assert the invariant (the slug is in the URL), not the route prefix — the
    // /r/<slug> path is a Phase-1 detail flagged for change (viewer-origin split).
    // The round-trip fetch below is the real functional coverage regardless of path.
    expect(body.view_url as string).toContain(body.slug as string);
    expect(body.version).toBe(version);
    expect(body.scan_status).toBe(scanStatus);
  },
);

Then('the "view_url" shows the scanning holding page', async ({ request }) => {
  // Promotion is async now (ADR-0045): immediately after upload the version is
  // `pending`, so the viewer serves the ADR-0038 holding page (200, noindex),
  // not the content. This is the core behavior this PR introduces.
  const viewed = await request.get(body.view_url as string);
  expect(viewed.status()).toBe(200);
  const text = await viewed.text();
  expect(text).toContain("Scanning");
  expect(text).not.toContain(MARKER);
  expect(viewed.headers()["x-robots-tag"] ?? "").toContain("noindex");
});

Then(
  'after the scan drain runs, the "view_url" serves the uploaded report',
  async ({ request }) => {
    // The full drain→promote round-trip needs the bearer secret to POST the
    // drain (CF cron only targets prod). When it's exposed to the test env we
    // drive it and poll until the clean version is promoted + served; otherwise
    // the holding-page assertion above is the CI coverage. (Follow-up: expose
    // SCAN_DRAIN_SECRET to the e2e job so this runs in CI too.)
    const secret = process.env.SCAN_DRAIN_SECRET;
    if (!secret) {
      // biome-ignore lint/suspicious/noConsole: surfaces the partial coverage in CI logs.
      console.warn("SCAN_DRAIN_SECRET unset — skipping the drain→promote round-trip");
      return;
    }
    const drain = await request.post("/internal/scan-drain", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(drain.status(), await drain.text()).toBe(200);
    await expect
      .poll(async () => (await request.get(body.view_url as string)).then((r) => r.text()), {
        timeout: 30_000,
        intervals: [1_000, 2_000, 3_000, 5_000],
      })
      .toContain(MARKER);
  },
);
