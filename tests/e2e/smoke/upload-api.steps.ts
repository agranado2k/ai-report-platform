import { type APIResponse, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { When, Then } = createBdd();

// Self-contained module state — workers: 1 (see playwright.config.ts) makes this
// safe for a single smoke scenario. Distinct step phrasing from health.steps.ts
// so the global step registry has no duplicate definitions.
let response: APIResponse;
let body: Record<string, unknown>;

// A marker unique PER RUN keeps the upload hermetic. Previews share the prod DB,
// and an identical body derives the same idempotency key (ADR-0039), so fixed
// content would *replay* a prior run's upload. Unique content => a fresh
// `pending` report every run.
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
  'the upload body has a "slug", a canonical "view_url", a "version" of {int}, and "scan_status" of {string}',
  async ({}, version: number, scanStatus: string) => {
    expect(typeof body.slug).toBe("string");
    expect((body.slug as string).length).toBeGreaterThan(0);

    // The canonical viewer URL is `<base>/<slug>` on the view origin (ADR-002 /
    // ADR-0038) — the slug is the WHOLE path, no `/r/` prefix.
    expect(typeof body.view_url).toBe("string");
    const viewUrl = new URL(body.view_url as string);
    expect(viewUrl.pathname).toBe(`/${body.slug}`);
    expect(body.view_url as string).not.toContain("/r/");
    // On prod the API pins VIEW_ORIGIN; previews fall back to the request origin,
    // so we only assert the origin when the test env knows the canonical one.
    if (process.env.VIEW_ORIGIN) {
      expect(viewUrl.origin).toBe(new URL(process.env.VIEW_ORIGIN).origin);
    }

    expect(body.version).toBe(version);
    expect(body.scan_status).toBe(scanStatus);
  },
);
