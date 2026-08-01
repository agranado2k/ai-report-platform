import { type APIResponse, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  mintSecondTestSession,
  mintThirdTestSession,
  type TestSession,
} from "../support/clerk-session";

const { Given, When, Then } = createBdd();

// Module state — workers: 1 makes this safe (see playwright.config.ts). Distinct
// step phrasing from auth-upload.steps.ts / upload-api.steps.ts so the global
// registry has no clashes.
let session: TestSession;
let response: APIResponse;
let body: Record<string, unknown>;

// The ADR-0074 shared-org scenario's third same-domain identity.
let thirdSession: TestSession;
let thirdBody: Record<string, unknown>;

const MARKER = `arp-team-org-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const HTML = `<!doctype html><html><body><h1>${MARKER}</h1></body></html>`;
const THIRD_MARKER = `arp-team-org-third-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const THIRD_HTML = `<!doctype html><html><body><h1>${THIRD_MARKER}</h1></body></html>`;

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

// ── ADR-0074: two same-domain identities share one team org ────────────────

Given("I am also signed in as the third \\(same-domain) Clerk test user", async () => {
  thirdSession = await mintThirdTestSession();
});

When(
  "the third identity uploads its own HTML report file to {string}",
  async ({ request }, path: string) => {
    // The third identity's first WRITE — this is what JIT-provisions it into
    // the domain's canonical org (reads never provision).
    const res = await request.post(path, {
      headers: { Authorization: `Bearer ${thirdSession.jwt}` },
      multipart: {
        file: {
          name: "report-third.html",
          mimeType: "text/html",
          buffer: Buffer.from(THIRD_HTML, "utf8"),
        },
      },
    });
    thirdBody = (await res.json()) as Record<string, unknown>;
    expect(res.status(), JSON.stringify(thirdBody)).toBe(201);
  },
);

Then(
  "the third identity's report listing includes both same-domain uploads",
  async ({ request }) => {
    // The listing must be read through a surface whose org is DETERMINISTIC.
    // A bare session GET is not: an org-less session's read path resolves the
    // user's OLDEST Clerk membership, and both fixtures carry older decoy
    // memberships (gold's forced-task decoy org; silver's legacy hand-made
    // org) that have no DB mirror — the GET would 401/empty regardless of the
    // join outcome. So the third identity first mints an `arp_` API key via
    // the WRITE path (/settings/api-keys — its actor's org comes from the
    // ADR-0074 canonical chain, the thing under test), then lists with the
    // key: door 1 carries the key's issuing org directly.
    const keyRes = await request.post("/settings/api-keys", {
      headers: { Authorization: `Bearer ${thirdSession.jwt}` },
      // Unique name per run — the ADR-0039 derived idempotency key
      // fingerprints on (name, scopes), and a replayed mint returns a null
      // secret by design.
      form: { name: `arp-e2e-team-org-${Date.now().toString(36)}` },
    });
    const keyBody = (await keyRes.json()) as { secret?: string };
    expect(keyRes.status(), JSON.stringify(keyBody)).toBe(200);
    expect(typeof keyBody.secret, "key mint must return the one-time secret").toBe("string");

    const res = await request.get("/api/v1/reports?limit=100", {
      headers: { Authorization: `Bearer ${keyBody.secret}` },
    });
    const listing = (await res.json()) as {
      data?: ReadonlyArray<{ slug?: string }>;
    };
    expect(res.status(), JSON.stringify(listing)).toBe(200);
    const slugs = (listing.data ?? []).map((r) => r.slug);
    // Its own upload proves the actor resolved into the key's org; the SECOND
    // identity's slug being visible proves both identities share one org row —
    // the ADR-0074 invariant.
    expect(slugs, "third identity's own upload must be listed").toContain(thirdBody.slug);
    expect(
      slugs,
      "the SECOND identity's upload must be visible to the third — same-domain identities share one org (ADR-0074)",
    ).toContain(body.slug);
  },
);
