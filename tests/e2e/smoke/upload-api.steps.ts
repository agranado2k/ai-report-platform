import { type APIResponse, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { When, Then } = createBdd();

// Self-contained module state — workers: 1 (see playwright.config.ts) makes this
// safe for a single smoke scenario. Distinct step phrasing from health.steps.ts
// so the global step registry has no duplicate definitions.
let response: APIResponse;
let body: Record<string, unknown>;

// A unique marker so the served page can be asserted to be THIS upload (the slug
// factory is random; the marker is the only content we control end-to-end).
const MARKER = "arp-smoke-upload-marker";
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
    expect(body.view_url as string).toContain(`/r/${body.slug}`);
    expect(body.version).toBe(version);
    expect(body.scan_status).toBe(scanStatus);
  },
);

Then('fetching the "view_url" serves the uploaded report', async ({ request }) => {
  const viewUrl = body.view_url as string;
  const viewed = await request.get(viewUrl);
  expect(viewed.status(), `GET ${viewUrl}`).toBe(200);
  expect(await viewed.text()).toContain(MARKER);
});
