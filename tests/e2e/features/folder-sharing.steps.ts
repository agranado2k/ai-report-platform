import { type APIRequestContext, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  cleanupTeamFixture,
  ensureTeamFixtureUser,
  mintTestSessionFor,
  runScopedTeamEmail,
  type TeamFixture,
  type TestSession,
} from "../support/clerk-session";

const { Given, When, Then, After } = createBdd();

// ADR-0087 — folder management RELOCATED from the in-body sidebar tree to the
// content-header panel. Two surfaces now carry the behaviour, and this suite
// drives both through the same cookie-auth doors a browser click uses:
//   • WRITES still post to the dashboard's OWN Remix action (form POST to
//     `/?index`) — the panel submits these intents via useFetcher; at the HTTP
//     boundary they are identical.
//   • the lazy ROSTER / cascade / bulk-apply context is read over
//     `GET /api/v1/folders/{id}/shares?include=manage` — the exact request the
//     panel's `useFetcher.load()` fires (the panel's management body is
//     client-rendered, so it never appears in the dashboard's initial HTML).
//   • folder VISIBILITY to another member is observed on the `_app` shell nav
//     RAIL, the sole navigation surface (the in-body tree is gone).
//   • the content-header BADGE (count-less) is read from the dashboard SSR.
//
// The client fetcher INTERACTION itself (clicking "Manage ▾"; the form-remount
// / autocomplete=off restoration guard) is covered by the panel's node-render
// smoke test (ADR-0079); a full real-browser drive is the deferred aspiration.
//
// Step phrasing is deliberately distinct from every other suite (the
// playwright-bdd step registry is global). Module state is safe under
// `workers: 1` (see playwright.config.ts).

const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const OWNER_EMAIL = runScopedTeamEmail("fsown", RUN_ID);
const COLLEAGUE_EMAIL = runScopedTeamEmail("fscol", RUN_ID);

/** Run-scoped folder names: a leaked folder from an earlier run can neither
 *  satisfy nor break this run's "is it in the rail?" assertions. */
const PARENT_NAME = `arp-fs-parent-${RUN_ID}`;
const CHILD_NAME = `arp-fs-child-${RUN_ID}`;

let ownerFixture: TeamFixture | undefined;
let colleagueFixture: TeamFixture | undefined;
let ownerSession: TestSession;
let colleagueSession: TestSession;
let parentFolderId: string | undefined;
let childFolderId: string | undefined;
let rootFolderId: string | undefined;

function requireSecretKey(): string {
  const secretKey = process.env.E2E_CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("@auth e2e needs E2E_CLERK_SECRET_KEY");
  return secretKey;
}

/** Same Bearer rationale as the other @auth suites: staging is a Clerk
 *  DEVELOPMENT instance, so a backend-minted session travels in the
 *  Authorization header, never the `__session` cookie. Clerk's
 *  `authenticateRequest` accepts the header on document routes too, so the
 *  dashboard's root gate and its loader/action both see a signed-in user. */
function auth(jwt: string): Record<string, string> {
  return { Authorization: `Bearer ${jwt}` };
}

/** GET the dashboard as `jwt` and return its HTML. Asserts 200 + the page's
 *  own heading FIRST, so an auth redirect or a 500 fails here with a clear
 *  message instead of as a puzzling "folder not found in markup" later. */
async function dashboard(
  request: APIRequestContext,
  jwt: string,
  query = "",
  label = "dashboard",
): Promise<string> {
  const res = await request.get(`/${query}`, { headers: auth(jwt) });
  const html = await res.text();
  expect(res.status(), `${label}: ${html.slice(0, 400)}`).toBe(200);
  expect(html, `${label}: the dashboard did not render`).toContain("Your reports");
  return html;
}

/** The dashboard's action URL. `?index` is NOT decoration: an index route and
 *  its parent share the URL `/`, so a bare `POST /` addresses the ROOT route —
 *  which has no action, and Remix answers 405 without ever running the
 *  dashboard's. The panel's `fetcher.Form` inside this index route appends
 *  `?index` itself, so this IS the URL a browser click submits to. */
const DASHBOARD_ACTION = "/?index";

/** Submit one of the dashboard's own forms (urlencoded, exactly as the panel's
 *  fetcher would) and assert it was accepted. */
async function submit(
  request: APIRequestContext,
  jwt: string,
  form: Record<string, string>,
  label: string,
): Promise<void> {
  const res = await request.post(DASHBOARD_ACTION, { headers: auth(jwt), form });
  const html = await res.text();
  expect(res.status(), `${label}: ${html.slice(0, 600)}`).toBeLessThan(400);
}

/** Resolve folder ids by NAME through the JSON API. Ids are opaque and the
 *  markup that carries them is an implementation detail. */
async function folderIdByName(
  request: APIRequestContext,
  jwt: string,
  name: string | null,
): Promise<string | undefined> {
  const res = await request.get("/api/v1/folders?limit=100", { headers: auth(jwt) });
  const text = await res.text();
  expect(res.status(), `folder list: ${text.slice(0, 400)}`).toBe(200);
  const list = JSON.parse(text) as {
    data?: ReadonlyArray<{ id?: string; name?: string; parent_id?: string | null }>;
  };
  const match = (list.data ?? []).find((f) =>
    name === null ? f.parent_id === null : f.name === name,
  );
  return match?.id;
}

interface ManageWire {
  readonly shares: ReadonlyArray<{ email: string; grantedAt: string }>;
  readonly reportSharing: { visibleCount: number; overCap: boolean } | null;
  readonly badge: { label: string };
  readonly cascadeLabel: string | null;
  readonly shareWarning: string | null;
}

/** The lazy management payload — the exact request the panel's "Manage ▾" fires
 *  (ADR-0087). Owner-or-legacy + `acl:write` gated, so a non-owner is refused
 *  here, not handed an empty roster. */
async function manageContext(
  request: APIRequestContext,
  jwt: string,
  folderId: string,
  label: string,
): Promise<ManageWire> {
  const res = await request.get(`/api/v1/folders/${folderId}/shares?include=manage`, {
    headers: auth(jwt),
  });
  const text = await res.text();
  expect(res.status(), `${label}: ${text.slice(0, 400)}`).toBe(200);
  return JSON.parse(text) as ManageWire;
}

/** The count-less visibility badge in the dashboard's content-header PANEL (the
 *  only `<section>` with the panel's card class — the selected folder). */
function contentHeaderBadge(html: string): string {
  const at = html.indexOf("rounded-card border border-border bg-surface px-4 py-3");
  expect(at, "no content-header management panel rendered for the selected folder").toBeGreaterThan(
    -1,
  );
  const badge = html.slice(at, at + 700).match(/rounded-full[^"]*"[^>]*>([^<]*)</);
  expect(badge, "no visibility badge in the content header").not.toBeNull();
  return (badge?.[1] ?? "").trim();
}

/** The panel's "Manage ▾" disclosure — present only for a manageable folder. */
function hasManageDisclosure(html: string): boolean {
  return /Manage<span aria-hidden="true">/.test(html);
}

/** The shell nav rail renders a folder as `<span class="truncate">name</span>`
 *  (FolderNavTree). It is the sole navigation surface, so this reflects folder
 *  VISIBILITY to whoever is signed in. */
function railShowsFolder(html: string, folderName: string): boolean {
  return html.includes(`>${folderName}</span>`);
}

// ── Identities ─────────────────────────────────────────────────────────────

Given("a folder-sharing owner identity is signed in", async () => {
  const secretKey = requireSecretKey();
  ownerFixture = await ensureTeamFixtureUser(secretKey, OWNER_EMAIL);
  ownerSession = await mintTestSessionFor(secretKey, OWNER_EMAIL);
});

Given("a folder-sharing colleague identity is signed in", async () => {
  const secretKey = requireSecretKey();
  colleagueFixture = await ensureTeamFixtureUser(secretKey, COLLEAGUE_EMAIL);
  colleagueSession = await mintTestSessionFor(secretKey, COLLEAGUE_EMAIL);
});

// ── Creating folders through the dashboard's own form ───────────────────────

When("the owner creates a run-scoped parent folder", async ({ request }) => {
  // The owner's first WRITE — this JIT-provisions them into the team domain's
  // canonical org (their session carries a decoy org, which the mirror-miss
  // branch must ignore).
  rootFolderId = await folderIdByName(request, ownerSession.jwt, null);
  expect(rootFolderId, "the org Root folder must exist (root-always-org, ADR-0076)").toBeTruthy();
  await submit(
    request,
    ownerSession.jwt,
    { intent: "new-folder", parentId: rootFolderId as string, name: PARENT_NAME },
    "create the parent folder",
  );
  parentFolderId = await folderIdByName(request, ownerSession.jwt, PARENT_NAME);
  expect(parentFolderId, "the new parent folder must be listed for its creator").toBeTruthy();
});

When(
  "the owner creates a run-scoped child folder inside the parent folder",
  async ({ request }) => {
    await submit(
      request,
      ownerSession.jwt,
      { intent: "new-folder", parentId: parentFolderId as string, name: CHILD_NAME },
      "create the child folder",
    );
    childFolderId = await folderIdByName(request, ownerSession.jwt, CHILD_NAME);
    expect(childFolderId, "the new child folder must be listed for its creator").toBeTruthy();
  },
);

// ── The content header + the lazy manage payload ────────────────────────────

Then(
  "the owner's content header badges the parent folder {string}",
  async ({ request }, expected: string) => {
    // Selecting the folder renders its content-header panel (name + count-less
    // badge); the badge is upgraded to "Shared with N" only after the client
    // roster load, which is asserted on the manage payload instead.
    const html = await dashboard(
      request,
      ownerSession.jwt,
      `?folder=${parentFolderId}`,
      "owner dashboard (folder selected)",
    );
    expect(contentHeaderBadge(html)).toBe(expected);
  },
);

Then("the owner's content header names the parent folder in full", async ({ request }) => {
  // The name is clipped for width; the full name lives in a `title` so it can be
  // read on hover without opening anything (2026-08-03 dogfood, I-1).
  const html = await dashboard(
    request,
    ownerSession.jwt,
    `?folder=${parentFolderId}`,
    "owner dashboard (folder selected)",
  );
  expect(html, "the folder name must carry its full text as a tooltip").toContain(
    `title="${PARENT_NAME}"`,
  );
});

Then("the owner's content header offers no management for the Root folder", async ({ request }) => {
  // ADR-0087 §Root: the domain refuses every visibility/share/rename/delete on
  // the Root, so its content header is HUSHED — no panel, no name, no "Manage".
  const rootHtml = await dashboard(
    request,
    ownerSession.jwt,
    `?folder=${rootFolderId}`,
    "owner dashboard (Root selected)",
  );
  expect(hasManageDisclosure(rootHtml), "the Root must not offer management").toBe(false);
  // …while a manageable folder on the same surface DOES, proving the absence is
  // the Root rule and not a page that rendered no panel at all.
  const parentHtml = await dashboard(
    request,
    ownerSession.jwt,
    `?folder=${parentFolderId}`,
    "owner dashboard (parent selected)",
  );
  expect(hasManageDisclosure(parentHtml)).toBe(true);
});

Then(
  "the owner's manage payload names the cascade direction and the count",
  async ({ request }) => {
    // "Also apply to everything inside" said the same thing whether it was about
    // to hide two folders or publish twenty. The label is computed server-side
    // from the actor's visible tree and carried in the manage payload.
    const ctx = await manageContext(
      request,
      ownerSession.jwt,
      parentFolderId as string,
      "owner manage payload",
    );
    expect(ctx.cascadeLabel).toContain(
      "Also share the 1 folder inside this one with the whole org",
    );
  },
);

Then("the owner's manage payload lists the colleague's email", async ({ request }) => {
  const ctx = await manageContext(
    request,
    ownerSession.jwt,
    parentFolderId as string,
    "owner manage payload (shared)",
  );
  expect(ctx.shares.map((s) => s.email)).toContain(COLLEAGUE_EMAIL);
});

Then(
  "the owner's manage payload badges the parent folder {string}",
  async ({ request }, expected: string) => {
    // "Shared with N" is derivable only where the roster was loaded — which is
    // exactly the manage payload the panel fetches on "Manage ▾".
    const ctx = await manageContext(
      request,
      ownerSession.jwt,
      parentFolderId as string,
      "owner manage payload (badge)",
    );
    expect(ctx.badge.label).toBe(expected);
  },
);

Then("the owner's manage payload roster is empty", async ({ request }) => {
  const ctx = await manageContext(
    request,
    ownerSession.jwt,
    parentFolderId as string,
    "owner manage payload (empty)",
  );
  expect(ctx.shares).toHaveLength(0);
  expect(ctx.shares.map((s) => s.email)).not.toContain(COLLEAGUE_EMAIL);
});

Then(
  "the owner's org-shared manage payload does not claim only they can see the folder",
  async ({ request }) => {
    // ADR-0076 exists because folder names leaked org-wide. An org-visible
    // folder with no INDIVIDUAL shares must read "Org" with an empty roster —
    // never a privacy claim.
    const ctx = await manageContext(
      request,
      ownerSession.jwt,
      parentFolderId as string,
      "owner manage payload (org)",
    );
    expect(ctx.badge.label).toBe("Org");
    expect(ctx.shares, "an org-visible folder has no individual shares yet").toHaveLength(0);
  },
);

Then("the colleague's manage read for the parent folder is refused", async ({ request }) => {
  // The lazy read IS the authorization gate (owner-or-legacy + acl:write): a
  // member who can SEE the folder but does not own it is refused the roster,
  // never handed an empty one.
  const res = await request.get(`/api/v1/folders/${parentFolderId}/shares?include=manage`, {
    headers: auth(colleagueSession.jwt),
  });
  expect(res.status(), "a non-owner must not read a folder's roster").toBeGreaterThanOrEqual(400);
});

// ── The shell nav rail (folder visibility to another member) ─────────────────

Then("the colleague's rail does not show the parent folder", async ({ request }) => {
  const html = await dashboard(request, colleagueSession.jwt, "", "colleague dashboard");
  expect(
    railShowsFolder(html, PARENT_NAME),
    "a private folder's NAME must not reach a colleague's rail (ADR-0076)",
  ).toBe(false);
});

Then("the colleague's rail shows the parent folder", async ({ request }) => {
  const html = await dashboard(request, colleagueSession.jwt, "", "colleague dashboard");
  expect(railShowsFolder(html, PARENT_NAME)).toBe(true);
});

Then("the colleague's rail no longer shows the parent folder", async ({ request }) => {
  const html = await dashboard(request, colleagueSession.jwt, "", "colleague dashboard");
  expect(railShowsFolder(html, PARENT_NAME)).toBe(false);
});

Then("the colleague's rail still shows the child folder", async ({ request }) => {
  // THE GAP, made visible: the child is still org-visible, and because its
  // parent is now invisible to the colleague it grafts under Root — its name
  // leaks from a folder its owner believes they just made private.
  const html = await dashboard(request, colleagueSession.jwt, "", "colleague dashboard");
  expect(
    railShowsFolder(html, CHILD_NAME),
    "ADR-0076's repair is per-folder: an already-org descendant survives the parent going private",
  ).toBe(true);
});

Then("the colleague's rail shows neither the parent nor the child folder", async ({ request }) => {
  const html = await dashboard(request, colleagueSession.jwt, "", "colleague dashboard");
  expect(railShowsFolder(html, PARENT_NAME)).toBe(false);
  expect(railShowsFolder(html, CHILD_NAME), "the cascade must reach the descendant").toBe(false);
});

// ── Visibility toggles, with and without the cascade ────────────────────────

When("the owner shares the parent folder with the whole org", async ({ request }) => {
  await submit(
    request,
    ownerSession.jwt,
    { intent: "set-folder-visibility", folderId: parentFolderId as string, visibility: "org" },
    "share the parent folder org-wide",
  );
});

When("the owner shares the child folder with the whole org", async ({ request }) => {
  await submit(
    request,
    ownerSession.jwt,
    { intent: "set-folder-visibility", folderId: childFolderId as string, visibility: "org" },
    "share the child folder org-wide",
  );
});

When("the owner makes the parent folder private WITHOUT the cascade", async ({ request }) => {
  await submit(
    request,
    ownerSession.jwt,
    { intent: "set-folder-visibility", folderId: parentFolderId as string, visibility: "private" },
    "make the parent folder private (no cascade)",
  );
});

When("the owner makes the parent folder private WITH the cascade", async ({ request }) => {
  // `cascade=on` is exactly what the panel's checkbox submits.
  await submit(
    request,
    ownerSession.jwt,
    {
      intent: "set-folder-visibility",
      folderId: parentFolderId as string,
      visibility: "private",
      cascade: "on",
    },
    "make the parent folder private (cascade)",
  );
});

// ── Person shares ──────────────────────────────────────────────────────────

When("the owner shares the parent folder with the colleague's email", async ({ request }) => {
  await submit(
    request,
    ownerSession.jwt,
    { intent: "share-folder", folderId: parentFolderId as string, email: COLLEAGUE_EMAIL },
    "share the parent folder by email",
  );
});

When("the owner removes the colleague's share", async ({ request }) => {
  await submit(
    request,
    ownerSession.jwt,
    { intent: "unshare-folder", folderId: parentFolderId as string, email: COLLEAGUE_EMAIL },
    "remove the colleague's share",
  );
});

// Best-effort accumulation bound, pass or fail: delete the folders this run
// created (deepest first — a non-empty folder is refused), then the run-scoped
// users. `cleanupTeamFixture` never throws; a hiccup logs rather than masking
// the scenario.
After({ tags: "@run-scoped" }, async ({ request }) => {
  const secretKey = process.env.E2E_CLERK_SECRET_KEY;
  if (!secretKey) return;
  // playwright-bdd's hook registry is GLOBAL, so this fires after EVERY
  // @run-scoped scenario. Our own fixtures being present is what identifies our
  // scenario; they are cleared at the end of this hook, so a second firing is
  // inert.
  if (!ownerFixture && !colleagueFixture) return;
  for (const id of [childFolderId, parentFolderId]) {
    if (!id) continue;
    try {
      await request.delete(`/api/v1/folders/${id}`, { headers: auth(ownerSession.jwt) });
    } catch (error) {
      console.warn(`folder-sharing cleanup: could not delete ${id} — ${String(error)}`);
    }
  }
  if (ownerFixture) await cleanupTeamFixture(secretKey, ownerFixture);
  if (colleagueFixture) await cleanupTeamFixture(secretKey, colleagueFixture);
  ownerFixture = undefined;
  colleagueFixture = undefined;
  parentFolderId = undefined;
  childFolderId = undefined;
  rootFolderId = undefined;
});
