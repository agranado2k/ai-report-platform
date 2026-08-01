import { type APIRequestContext, type APIResponse, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  cleanupTeamFixture,
  ensureTeamFixtureUser,
  findAnchoredOrgMembership,
  mintSecondTestSession,
  mintTestSessionFor,
  runScopedTeamEmail,
  TEAM_ORG_DOMAIN,
  type TeamFixture,
  type TestSession,
} from "../support/clerk-session";

const { Given, When, Then, After } = createBdd();

// Module state — workers: 1 makes this safe (see playwright.config.ts). Distinct
// step phrasing from auth-upload.steps.ts / upload-api.steps.ts so the global
// registry has no clashes.
let session: TestSession;
let response: APIResponse;
let body: Record<string, unknown>;

const MARKER = `arp-team-org-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const HTML = `<!doctype html><html><body><h1>${MARKER}</h1></body></html>`;

// ── ADR-0074 shared-org scenario: RUN-SCOPED identities ────────────────────
// Fixed at worker start; unique per run so a FRESH pair of users exists for
// every CI run — a user that didn't exist before this run cannot carry a
// poisoned mirror from earlier runs / older code in the persistent,
// prod-forked preview DB branch (the PR #222 round-3 contamination, which the
// sticky-after-mirror policy then correctly honors — masking the canonical
// chain this scenario exists to prove).
const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const FIRST_EMAIL = runScopedTeamEmail("silver", RUN_ID);
const SECOND_EMAIL = runScopedTeamEmail("gold", RUN_ID);

let firstFixture: TeamFixture | undefined;
let secondFixture: TeamFixture | undefined;
let firstSession: TestSession;
let secondSession: TestSession;
let firstBody: Record<string, unknown>;
let secondBody: Record<string, unknown>;

const FIRST_MARKER = `arp-team-org-a-${RUN_ID}`;
const FIRST_HTML = `<!doctype html><html><body><h1>${FIRST_MARKER}</h1></body></html>`;
const SECOND_MARKER = `arp-team-org-b-${RUN_ID}`;
const SECOND_HTML = `<!doctype html><html><body><h1>${SECOND_MARKER}</h1></body></html>`;

function requireSecretKey(): string {
  const secretKey = process.env.E2E_CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("@auth e2e needs E2E_CLERK_SECRET_KEY");
  return secretKey;
}

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

async function uploadHtml(
  request: APIRequestContext,
  path: string,
  jwt: string,
  filename: string,
  html: string,
  label: string,
): Promise<Record<string, unknown>> {
  const res = await request.post(path, {
    headers: { Authorization: `Bearer ${jwt}` },
    multipart: {
      file: { name: filename, mimeType: "text/html", buffer: Buffer.from(html, "utf8") },
    },
  });
  return expectJson(res, 201, label);
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

Given("a first run-scoped team-domain identity is signed in", async () => {
  const secretKey = requireSecretKey();
  firstFixture = await ensureTeamFixtureUser(secretKey, FIRST_EMAIL);
  firstSession = await mintTestSessionFor(secretKey, FIRST_EMAIL);
});

Given("a second run-scoped team-domain identity is signed in", async () => {
  const secretKey = requireSecretKey();
  secondFixture = await ensureTeamFixtureUser(secretKey, SECOND_EMAIL);
  secondSession = await mintTestSessionFor(secretKey, SECOND_EMAIL);
});

When(
  "the first run-scoped identity uploads an HTML report file to {string}",
  async ({ request }, path: string) => {
    // The identity's first WRITE — this is what JIT-provisions it into the
    // domain's canonical org (reads never provision). Its session actively
    // carries the DECOY org (Clerk auto-activates the sole membership under
    // force_organization_selection), so this exercises the sticky-after-mirror
    // policy's mirror-miss branch: the unmirrored session org must be IGNORED
    // in favor of the canonical chain.
    firstBody = await uploadHtml(
      request,
      path,
      firstSession.jwt,
      "report-first.html",
      FIRST_HTML,
      "first run-scoped identity's upload",
    );
  },
);

When(
  "the second run-scoped identity uploads its own HTML report file to {string}",
  async ({ request }, path: string) => {
    secondBody = await uploadHtml(
      request,
      path,
      secondSession.jwt,
      "report-second.html",
      SECOND_HTML,
      "second run-scoped identity's upload",
    );
  },
);

Then(
  "the second run-scoped identity's report listing includes both run-scoped uploads",
  async ({ request }) => {
    // The listing must be read through a session whose org is DETERMINISTIC:
    //  1. Resolve the second identity's membership in the ANCHORED domain org
    //     via the Clerk Backend API — its existence is itself the Clerk-side
    //     auto-join assertion (the upload's canonical chain must have joined
    //     it there, decoy notwithstanding).
    //  2. Re-mint its session with that org ACTIVE (POST /v1/sessions
    //     `active_organization_id`, verified against the live BAPI — the v2
    //     token's `o.id` claim carries it to the app's getAuth), exactly like
    //     a browser session after the user selects the org in Clerk's forced
    //     task.
    //  3. Bare GET /api/v1/reports with that session — the read path uses the
    //     session org directly.
    const secretKey = requireSecretKey();

    const canonicalOrgId = await findAnchoredOrgMembership(
      secretKey,
      SECOND_EMAIL,
      TEAM_ORG_DOMAIN,
    );
    expect(
      canonicalOrgId,
      `after its first upload the second run-scoped identity must be a MEMBER of the anchored ` +
        `"${TEAM_ORG_DOMAIN}" org in Clerk (the ADR-0074 canonical chain's join) — no such ` +
        "membership found",
    ).toBeTruthy();

    const orgSession = await mintTestSessionFor(secretKey, SECOND_EMAIL, canonicalOrgId as string);
    const res = await request.get("/api/v1/reports?limit=100", {
      headers: { Authorization: `Bearer ${orgSession.jwt}` },
    });
    const listing = (await expectJson(res, 200, "run-scoped org listing")) as {
      data?: ReadonlyArray<{ slug?: string }>;
    };
    const slugs = (listing.data ?? []).map((r) => r.slug);
    // Its own upload proves the session org is the org the write path mirrored
    // into; the FIRST identity's slug being visible proves both identities
    // share one org row — the ADR-0074 invariant.
    expect(slugs, "second run-scoped identity's own upload must be listed").toContain(
      secondBody.slug,
    );
    expect(
      slugs,
      "the FIRST run-scoped identity's upload must be visible to the second — same-domain " +
        "identities share one org (ADR-0074)",
    ).toContain(firstBody.slug);
  },
);

// Best-effort accumulation bound: delete the run-scoped users (+ their decoy
// orgs) after every attempt of the @run-scoped scenario, pass or fail. Deleting
// the users also removes their canonical-org memberships, keeping the shared
// anchored org's member count flat across runs (the instance cap is finite —
// raised 5 → 20 to match prod, but still finite). cleanupTeamFixture never
// throws — a cleanup hiccup logs loudly instead of failing/masking the
// scenario; leaked users are for the periodic sweep (PR follow-up note).
After({ tags: "@run-scoped" }, async () => {
  const secretKey = process.env.E2E_CLERK_SECRET_KEY;
  if (!secretKey) return;
  if (firstFixture) await cleanupTeamFixture(secretKey, firstFixture);
  if (secondFixture) await cleanupTeamFixture(secretKey, secondFixture);
  firstFixture = undefined;
  secondFixture = undefined;
});

/** Parse a response body as JSON when possible; otherwise wrap the raw text so
 *  a later status assertion can still display it (never a bare SyntaxError). */
function safeParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw_non_json_body: text.slice(0, 500) };
  }
}
