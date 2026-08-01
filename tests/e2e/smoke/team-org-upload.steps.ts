import { type APIResponse, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  findAnchoredOrgMembership,
  mintSecondTestSession,
  mintTestSessionFor,
  mintThirdTestSession,
  type TestSession,
  THIRD_FIXTURE_EMAIL,
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

/** Assert status BEFORE parsing JSON, so an auth-redirect HTML body (or any
 *  non-JSON error page) fails with the real status + raw body — never as a
 *  bare SyntaxError from `.json()` (the PR #222 round-2 lesson). */
async function expectJson(
  res: APIResponse,
  expectedStatus: number,
  label: string,
): Promise<Record<string, unknown>> {
  const text = await res.text();
  expect(res.status(), `${label}: ${text.slice(0, 500)}`).toBe(expectedStatus);
  expect(
    res.headers()["content-type"] ?? "",
    `${label}: expected a JSON body, got: ${text.slice(0, 200)}`,
  ).toContain("application/json");
  return JSON.parse(text) as Record<string, unknown>;
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
    // Parsed leniently here — the dedicated Then step asserts the status and
    // shows the raw body on mismatch.
    const text = await response.text();
    body = safeParse(text);
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
    thirdBody = await expectJson(res, 201, "third identity's upload");
  },
);

Then(
  "the third identity's report listing includes both same-domain uploads",
  async ({ request }) => {
    // The listing must be read through a session whose org is DETERMINISTIC.
    // A bare (org-less) backend-minted session is not: the read path resolves
    // such a session via the user's OLDEST Clerk membership, and both fixtures
    // carry older unmirrored memberships (gold's forced-task decoy org;
    // silver's legacy hand-made org), so a bare GET would fail regardless of
    // the join outcome. Instead:
    //  1. Resolve gold's membership in the ANCHORED domain org via the Clerk
    //     Backend API — its existence is itself the Clerk-side auto-join
    //     assertion (the upload's canonical chain must have joined gold).
    //  2. Re-mint gold's session with that org ACTIVE (POST /v1/sessions
    //     `active_organization_id`, verified against the live BAPI — the v2
    //     token's `o.id` claim carries it to the app's getAuth), exactly like
    //     a browser session after the user selects the org in Clerk's forced
    //     task.
    //  3. Bare GET /api/v1/reports with that session — the read path uses the
    //     session org directly, no oldest-membership guess.
    const secretKey = process.env.E2E_CLERK_SECRET_KEY;
    expect(secretKey, "@auth e2e needs E2E_CLERK_SECRET_KEY").toBeTruthy();
    const domain = THIRD_FIXTURE_EMAIL.split("@")[1] as string;

    const canonicalOrgId = await findAnchoredOrgMembership(
      secretKey as string,
      THIRD_FIXTURE_EMAIL,
      domain,
    );
    expect(
      canonicalOrgId,
      `after its first upload the third identity must be a MEMBER of the anchored "${domain}" ` +
        "org in Clerk (the ADR-0074 canonical chain's join) — no such membership found",
    ).toBeTruthy();

    const orgSession = await mintTestSessionFor(
      secretKey as string,
      THIRD_FIXTURE_EMAIL,
      canonicalOrgId as string,
    );
    const res = await request.get("/api/v1/reports?limit=100", {
      headers: { Authorization: `Bearer ${orgSession.jwt}` },
    });
    const listing = (await expectJson(res, 200, "third identity's org listing")) as {
      data?: ReadonlyArray<{ slug?: string }>;
    };
    const slugs = (listing.data ?? []).map((r) => r.slug);
    // Its own upload proves the session org is the org the write path mirrored
    // into; the SECOND identity's slug being visible proves both identities
    // share one org row — the ADR-0074 invariant.
    expect(slugs, "third identity's own upload must be listed").toContain(thirdBody.slug);
    expect(
      slugs,
      "the SECOND identity's upload must be visible to the third — same-domain identities share one org (ADR-0074)",
    ).toContain(body.slug);
  },
);

/** Parse a response body as JSON when possible; otherwise wrap the raw text so
 *  a later status assertion can still display it (never a bare SyntaxError). */
function safeParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw_non_json_body: text.slice(0, 500) };
  }
}
