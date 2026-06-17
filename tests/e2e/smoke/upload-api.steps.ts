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

Then("the upload error code is {string}", async ({}, code: string) => {
  // RFC-9457 problem+json — the actor seam rejects anonymous writes (ADR-0048).
  expect(body.code, JSON.stringify(body)).toBe(code);
});
