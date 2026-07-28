import { type APIResponse, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { mintSecondTestSession, type TestSession } from "../support/clerk-session";

const { Given, When, Then } = createBdd();

// Module state — workers: 1 makes this safe (see playwright.config.ts). Distinct
// step phrasing from auth-upload.steps.ts / upload-api.steps.ts so the global
// registry has no clashes.
let session: TestSession;
let response: APIResponse;
let body: Record<string, unknown>;

const MARKER = `arp-team-org-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const HTML = `<!doctype html><html><body><h1>${MARKER}</h1></body></html>`;

// Same Bearer-header rationale as auth-upload.steps.ts: staging is a Clerk
// DEVELOPMENT instance, so a backend-minted session goes over Authorization,
// never the __session cookie (which needs a dev-browser token).
function sessionAuthHeader(): Record<string, string> {
  return { Authorization: `Bearer ${session.jwt}` };
}

// Escape the parens — Cucumber Expressions treat `()` as optional-text syntax,
// so the literal "(team-org)" in the .feature file must be matched as `\(...\)`.
Given("I am signed in as the second \\(team-org) Clerk test user", async () => {
  session = await mintSecondTestSession();
});

When(
  "I upload an HTML report file with my second session to {string}",
  async ({ request }, path: string) => {
    response = await request.post(path, {
      headers: sessionAuthHeader(),
      multipart: {
        file: { name: "report.html", mimeType: "text/html", buffer: Buffer.from(HTML, "utf8") },
      },
    });
    body = (await response.json()) as Record<string, unknown>;
  },
);

Then("the second session's upload response status is {int}", async ({}, status: number) => {
  expect(response.status(), JSON.stringify(body)).toBe(status);
});

Then("the second session's upload returns a slug and a canonical view_url", async () => {
  expect(typeof body.slug).toBe("string");
  expect((body.slug as string).length).toBeGreaterThan(0);
  expect(typeof body.view_url).toBe("string");
  const viewUrl = new URL(body.view_url as string);
  expect(viewUrl.pathname).toBe(`/${body.slug}`);
});
