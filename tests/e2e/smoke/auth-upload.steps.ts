import { type APIResponse, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { mintTestSession, type TestSession } from "../support/clerk-session";

const { Given, When, Then } = createBdd();

// Module state — workers: 1 makes this safe (see playwright.config.ts). Distinct
// step phrasing from upload-api.steps.ts so the global registry has no clashes.
let session: TestSession;
let dashboardHtml: string;
let response: APIResponse;
let body: Record<string, unknown>;

const MARKER = `arp-auth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const HTML = `<!doctype html><html><body><h1>${MARKER}</h1></body></html>`;

/**
 * Send the session as a Bearer token, NOT the `__session` cookie. Staging is a
 * Clerk DEVELOPMENT instance (pk_test): its cookie path requires a dev-browser
 * token and rejects a bare backend-minted session ("dev-browser-missing"). The
 * Authorization-header path (authenticateRequestWithTokenInHeader in
 * @clerk/backend) verifies the session JWT networklessly with no dev-browser —
 * which is exactly right for a machine/API test.
 */
function sessionAuthHeader(): Record<string, string> {
  return { Authorization: `Bearer ${session.jwt}` };
}

Given("I am signed in as the seeded Clerk test user", async () => {
  session = await mintTestSession();
});

When("I GET the dashboard with my session", async ({ request }) => {
  const res = await request.get("/", { headers: sessionAuthHeader() });
  expect(res.status(), "dashboard GET").toBe(200);
  dashboardHtml = await res.text();
});

Then("the server resolved my Clerk user id", async () => {
  // The root loader embeds getAuth's userId in the SSR payload. Its presence
  // proves the minted session was honored server-side — i.e. NOT the signed-out /
  // DEMO_ACTOR path, which the upload response alone can't distinguish.
  expect(dashboardHtml).toContain(session.userId);
});

When(
  "I upload an HTML report file with my session to {string}",
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

Then("the authenticated upload response status is {int}", async ({}, status: number) => {
  expect(response.status(), JSON.stringify(body)).toBe(status);
});

Then("the authenticated upload returns a slug and a canonical view_url", async () => {
  expect(typeof body.slug).toBe("string");
  expect((body.slug as string).length).toBeGreaterThan(0);
  expect(typeof body.view_url).toBe("string");
  const viewUrl = new URL(body.view_url as string);
  expect(viewUrl.pathname).toBe(`/${body.slug}`);
  expect(body.view_url as string).not.toContain("/r/");
});
