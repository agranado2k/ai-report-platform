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
// The provision-on-read identity (ADR-0048 amendment 2026-08-01): NEVER
// uploads — its first authenticated request is a bare session GET.
const THIRD_EMAIL = runScopedTeamEmail("bronze", RUN_ID);

let firstFixture: TeamFixture | undefined;
let secondFixture: TeamFixture | undefined;
let thirdFixture: TeamFixture | undefined;
let firstSession: TestSession;
let secondSession: TestSession;
let thirdSession: TestSession;
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

Given("a third run-scoped team-domain identity is signed in and never uploads", async () => {
  const secretKey = requireSecretKey();
  thirdFixture = await ensureTeamFixtureUser(secretKey, THIRD_EMAIL);
  thirdSession = await mintTestSessionFor(secretKey, THIRD_EMAIL);
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

When(
  "the first run-scoped identity shares its report org-wide via the ACL API",
  async ({ request }) => {
    // ADR-0075 setup: uploads are default-PRIVATE, so colleagues won't list
    // them. The OWNER (first identity) flips its report to `org` mode — the
    // mode built for the team-org listing surface. setAcl is owner-gated by
    // userId (ADR-0059 §2), so the decoy-carrying session still authorizes.
    const res = await request.post(`/api/v1/reports/${firstBody.slug}/acl`, {
      headers: {
        Authorization: `Bearer ${firstSession.jwt}`,
        "Content-Type": "application/json",
      },
      data: { mode: "org" },
    });
    await expectJson(res, 200, "first run-scoped identity's org-share setAcl");
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
    // into (listed via OWNERSHIP under ADR-0075); the FIRST identity's slug is
    // visible because its owner org-shared it — together they prove both
    // identities share one org row (ADR-0074) under visibility-scoped listing.
    expect(slugs, "second run-scoped identity's own upload must be listed").toContain(
      secondBody.slug,
    );
    expect(
      slugs,
      "the FIRST run-scoped identity's org-shared upload must be visible to the second — " +
        "same-domain identities share one org (ADR-0074) and `org` mode lists it (ADR-0075)",
    ).toContain(firstBody.slug);
  },
);

Then(
  "the third run-scoped identity's first-ever session read lists exactly the org-shared upload",
  async ({ request }) => {
    // Provision-on-read (ADR-0048 amendment 2026-08-01): the third identity has
    // NEVER written — before the amendment this bare session GET resolved a
    // null actor (unmirrored) and 401'd. The read door now lazily provisions
    // through the SAME canonical chain as the write door: the session actively
    // carries the identity's DECOY org (Clerk auto-activates the sole
    // membership), which the mirror-miss branch must IGNORE in favor of the
    // anchored domain org. No org re-mint here on purpose: the bare
    // decoy-carrying session IS the prod shape (a member who signed in but
    // never uploaded).
    //
    // VISIBILITY (ADR-0075): the third identity owns nothing, so its listing
    // is the pure colleague view — it must contain the FIRST identity's
    // org-shared report (proving all three resolved to ONE org row) and must
    // NOT contain the SECOND identity's still-default-private one (proving
    // private reports don't even surface as metadata inside the shared org).
    const res = await request.get("/api/v1/reports?limit=100", {
      headers: { Authorization: `Bearer ${thirdSession.jwt}` },
    });
    const listing = (await expectJson(
      res,
      200,
      "third run-scoped identity's provision-on-read listing",
    )) as { data?: ReadonlyArray<{ slug?: string }> };
    const slugs = (listing.data ?? []).map((r) => r.slug);
    expect(
      slugs,
      "a never-written org member's first read must see the org-SHARED report " +
        "(provision-on-read + ADR-0075 org-mode listing)",
    ).toContain(firstBody.slug);
    expect(
      slugs,
      "a colleague's default-PRIVATE report must NOT be listed — existence is private (ADR-0075)",
    ).not.toContain(secondBody.slug);

    // Belt-and-braces: the read really did provision — the identity is now a
    // member of the ANCHORED domain org on the Clerk side too.
    const secretKey = requireSecretKey();
    const canonicalOrgId = await findAnchoredOrgMembership(secretKey, THIRD_EMAIL, TEAM_ORG_DOMAIN);
    expect(
      canonicalOrgId,
      "the provision-on-read must have joined the third identity to the anchored " +
        `"${TEAM_ORG_DOMAIN}" org in Clerk`,
    ).toBeTruthy();
  },
);

// ── ADR-0076: folder visibility inside the shared team org ─────────────────

/** The run-scoped folder the FIRST identity creates (private by default) and
 *  later org-shares. Named uniquely per run so a leaked folder from an
 *  earlier run can't satisfy (or break) this run's assertions. */
const FOLDER_NAME = `arp-fv-${RUN_ID}`;
let folderId: string | undefined;

When(
  "the first run-scoped identity creates a private folder and moves its org-shared report into it",
  async ({ request }) => {
    // Root id first: the folder list is visibility-scoped (ADR-0076), but the
    // Root is always org-visible, so any member resolves it.
    const foldersRes = await request.get("/api/v1/folders?limit=100", {
      headers: { Authorization: `Bearer ${firstSession.jwt}` },
    });
    const folderList = (await expectJson(foldersRes, 200, "first identity's folder list")) as {
      data?: ReadonlyArray<{ id?: string; parent_id?: string | null }>;
    };
    const root = (folderList.data ?? []).find((f) => f.parent_id === null);
    expect(root?.id, "the org Root folder must be listed (root-always-org, ADR-0076)").toBeTruthy();

    // Create under Root → private by default, owned by the creator (ADR-0076).
    const created = await request.post("/api/v1/folders", {
      headers: {
        Authorization: `Bearer ${firstSession.jwt}`,
        "Content-Type": "application/json",
      },
      data: { name: FOLDER_NAME, parent_id: root?.id },
    });
    const folder = (await expectJson(created, 201, "run-scoped folder create")) as {
      id?: string;
      visibility?: string;
      owner?: string | null;
    };
    expect(folder.visibility, "a folder created under Root defaults PRIVATE (ADR-0076)").toBe(
      "private",
    );
    expect(folder.owner, "the creator owns the new folder (ADR-0076)").toBeTruthy();
    folderId = folder.id;

    // Move the (org-shared) report into it — the owner sees their own folder.
    const moved = await request.post(`/api/v1/reports/${firstBody.slug}/move`, {
      headers: {
        Authorization: `Bearer ${firstSession.jwt}`,
        "Content-Type": "application/json",
      },
      data: { folder_id: folderId },
    });
    await expectJson(moved, 200, "move org-shared report into the private folder");
  },
);

Then(
  "the third run-scoped identity lists the org-shared report but NOT the private folder",
  async ({ request }) => {
    // The REPORT stays listed (org-shared, ADR-0075) even though it now lives
    // in a folder the third identity cannot see…
    const reportsRes = await request.get("/api/v1/reports?limit=100", {
      headers: { Authorization: `Bearer ${thirdSession.jwt}` },
    });
    const reports = (await expectJson(reportsRes, 200, "third identity's report list")) as {
      data?: ReadonlyArray<{ slug?: string }>;
    };
    expect(
      (reports.data ?? []).map((r) => r.slug),
      "an org-shared report in an invisible folder must STAY listed (ADR-0075/0076)",
    ).toContain(firstBody.slug);

    // …while the FOLDER itself is absent — folder existence is private
    // (ADR-0076). The dashboard groups such reports under Root.
    const foldersRes = await request.get("/api/v1/folders?limit=100", {
      headers: { Authorization: `Bearer ${thirdSession.jwt}` },
    });
    const folderList = (await expectJson(foldersRes, 200, "third identity's folder list")) as {
      data?: ReadonlyArray<{ id?: string }>;
    };
    expect(
      (folderList.data ?? []).map((f) => f.id),
      "a colleague's PRIVATE folder must NOT be listed — existence is private (ADR-0076)",
    ).not.toContain(folderId);
  },
);

When("the first run-scoped identity sets the folder's visibility to org", async ({ request }) => {
  // Owner-gated; the Clerk session carries acl:write (same gate setAcl passed).
  const res = await request.post(`/api/v1/folders/${folderId}/visibility`, {
    headers: {
      Authorization: `Bearer ${firstSession.jwt}`,
      "Content-Type": "application/json",
    },
    data: { visibility: "org" },
  });
  const body = (await expectJson(res, 200, "owner sets folder visibility to org")) as {
    visibility?: string;
  };
  expect(body.visibility).toBe("org");
});

Then(
  "the third run-scoped identity's folder list now includes the run-scoped folder",
  async ({ request }) => {
    const res = await request.get("/api/v1/folders?limit=100", {
      headers: { Authorization: `Bearer ${thirdSession.jwt}` },
    });
    const folderList = (await expectJson(
      res,
      200,
      "third identity's folder list (after share)",
    )) as {
      data?: ReadonlyArray<{ id?: string }>;
    };
    expect(
      (folderList.data ?? []).map((f) => f.id),
      "an org-shared folder must appear in every member's tree (ADR-0076)",
    ).toContain(folderId);
  },
);

// ── ADR-0078: folder sharing REACHES the reports inside ────────────────────
//
// THE BUG THIS EXISTS FOR. Everything above leaves the third identity looking
// at a folder it can see and reports it can't — because a folder share confers
// visibility of the FOLDER (ADR-0076 §6), and each report's reach is still its
// own Acl. These four steps prove the ADR-0078 repair against real
// infrastructure, through the same doors a real client uses.

const PRIVATE_MARKER = `arp-e2e-private-${RUN_ID}`;
const PRIVATE_HTML = `<!doctype html><html><body><h1>${PRIVATE_MARKER}</h1></body></html>`;
let privateBody: Record<string, unknown>;

When(
  "the first run-scoped identity puts a private report inside the shared folder",
  async ({ request }) => {
    privateBody = await uploadHtml(
      request,
      "/api/v1/reports",
      firstSession.jwt,
      "report-private.html",
      PRIVATE_HTML,
      "first run-scoped identity's private upload",
    );
    // Uploads land in Root (ADR-0037), and a Root upload stays PRIVATE — the
    // ADR-0078 §6 carve-out, without which every upload in the product would
    // be org-visible.
    const moved = await request.post(`/api/v1/reports/${privateBody.slug}/move`, {
      headers: {
        Authorization: `Bearer ${firstSession.jwt}`,
        "Content-Type": "application/json",
      },
      data: { folder_id: folderId },
    });
    const movedBody = (await expectJson(moved, 200, "move the private report into the folder")) as {
      acl?: { mode?: string };
    };
    // ADR-0078 §7, proved end to end: moving into an ORG-VISIBLE folder must
    // NOT publish the report. Move is canWrite-gated, so an auto-apply would
    // let a write grantee — who has no view access at all (ADR-0060 §6) —
    // publish content they cannot read.
    expect(
      movedBody.acl?.mode,
      "moving a private report into an org-shared folder must NOT change its sharing (ADR-0078 §7)",
    ).toBe("private");
  },
);

Then(
  "the third run-scoped identity cannot see the private report inside the shared folder",
  async ({ request }) => {
    // THE REPORTED BUG, asserted as the pre-condition it is: the folder is
    // org-visible (proved two steps up) and the report inside it is still
    // invisible. This assertion must keep passing forever — the repair is an
    // EXPLICIT action, not a change to what a folder share means.
    const res = await request.get("/api/v1/reports?limit=100", {
      headers: { Authorization: `Bearer ${thirdSession.jwt}` },
    });
    const listing = (await expectJson(
      res,
      200,
      "third identity's listing before the bulk apply",
    )) as {
      data?: ReadonlyArray<{ slug?: string }>;
    };
    expect(
      (listing.data ?? []).map((r) => r.slug),
      "a private report inside an ORG-SHARED folder must still be invisible — a folder share " +
        "confers visibility of the FOLDER only (ADR-0076 §6, unchanged by ADR-0078)",
    ).not.toContain(privateBody.slug);
  },
);

When(
  "the first run-scoped identity shares the folder's reports for viewing and editing",
  async ({ request }) => {
    const res = await request.post(`/api/v1/folders/${folderId}/reports/sharing`, {
      headers: {
        Authorization: `Bearer ${firstSession.jwt}`,
        "Content-Type": "application/json",
      },
      data: { sharing: "org_edit" },
    });
    const outcome = (await expectJson(res, 200, "folder bulk apply")) as {
      changed?: ReadonlyArray<{ slug?: string }>;
      skipped?: ReadonlyArray<{ slug?: string; reason?: string }>;
      failed?: ReadonlyArray<{ slug?: string }>;
    };
    expect(
      (outcome.changed ?? []).map((c) => c.slug),
      "the private report the owner holds must be changed",
    ).toContain(privateBody.slug);
    // The honest partial result, end to end: the report that was ALREADY
    // org-shared is named back with its reason rather than counted as a change.
    const skipped = outcome.skipped ?? [];
    expect(
      skipped.map((c) => c.slug),
      "the already-org-shared report must be SKIPPED, not silently re-counted as changed",
    ).toContain(firstBody.slug);
    expect(skipped.find((c) => c.slug === firstBody.slug)?.reason).toBe(
      "already shared with your org",
    );
    expect(outcome.failed ?? [], "nothing should have failed").toHaveLength(0);
  },
);

Then(
  "the third run-scoped identity can list, open and edit the once-private report",
  async ({ request }) => {
    const auth = {
      Authorization: `Bearer ${thirdSession.jwt}`,
      "Content-Type": "application/json",
    };

    // SEES it — through ADR-0075's existing predicate, because its real Acl
    // changed. No new listing leg was needed for folders.
    const listRes = await request.get("/api/v1/reports?limit=100", {
      headers: { Authorization: `Bearer ${thirdSession.jwt}` },
    });
    const listing = (await expectJson(
      listRes,
      200,
      "third identity's listing after the bulk apply",
    )) as {
      data?: ReadonlyArray<{ slug?: string }>;
    };
    expect(
      (listing.data ?? []).map((r) => r.slug),
      "after the bulk apply the once-private report must be listed for every org member",
    ).toContain(privateBody.slug);

    // CAN OPEN it — the single-report read, which is what the dashboard row and
    // the viewer entry both go through.
    const getRes = await request.get(`/api/v1/reports/${privateBody.slug}`, {
      headers: { Authorization: `Bearer ${thirdSession.jwt}` },
    });
    const detail = (await expectJson(getRes, 200, "third identity opens the report")) as {
      slug?: string;
    };
    expect(detail.slug).toBe(privateBody.slug);

    // CAN EDIT it — a rename goes through the canWrite seam, so a 200 here is
    // the ADR-0078 §1 org-write leg working through the real HTTP door and not
    // just in a unit test. The third identity owns nothing and holds no
    // personal write grant, so this can ONLY be the org-write row.
    const renamed = await request.patch(`/api/v1/reports/${privateBody.slug}`, {
      headers: auth,
      data: { title: `renamed-by-colleague-${RUN_ID}` },
    });
    const renamedBody = (await expectJson(
      renamed,
      200,
      "org-write colleague renames the report",
    )) as { title?: string };
    expect(
      renamedBody.title,
      "an org-write colleague must be able to rename (ADR-0078 §1 canWrite leg)",
    ).toBe(`renamed-by-colleague-${RUN_ID}`);

    // …but DELETE stays owner-only in every sharing state (ADR-0059 §2,
    // reaffirmed by ADR-0078 §3). The coarse control must not have widened it.
    const deleted = await request.delete(`/api/v1/reports/${privateBody.slug}`, {
      headers: { Authorization: `Bearer ${thirdSession.jwt}` },
    });
    expect(
      deleted.status(),
      "DELETE must stay owner-only even at org_edit (ADR-0059 §2 / ADR-0078 §3)",
    ).toBe(403);
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
  if (thirdFixture) await cleanupTeamFixture(secretKey, thirdFixture);
  firstFixture = undefined;
  secondFixture = undefined;
  thirdFixture = undefined;
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
