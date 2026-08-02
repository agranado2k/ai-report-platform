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

// ADR-0076 §6 — the dashboard sharing UI, driven through its OWN Remix action
// (a form POST to `/`, cookie-auth door) rather than the Bearer `/api/v1`
// routes, because the action IS the thing under test: the browser never calls
// the JSON API. Assertions read the server-rendered sidebar markup.
//
// Step phrasing is deliberately distinct from every other suite (the
// playwright-bdd step registry is global). Module state is safe under
// `workers: 1` (see playwright.config.ts).

const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const OWNER_EMAIL = runScopedTeamEmail("fsown", RUN_ID);
const COLLEAGUE_EMAIL = runScopedTeamEmail("fscol", RUN_ID);

/** Run-scoped folder names: a leaked folder from an earlier run can neither
 *  satisfy nor break this run's "is it in the sidebar?" assertions. */
const PARENT_NAME = `arp-fs-parent-${RUN_ID}`;
const CHILD_NAME = `arp-fs-child-${RUN_ID}`;

let ownerFixture: TeamFixture | undefined;
let colleagueFixture: TeamFixture | undefined;
let ownerSession: TestSession;
let colleagueSession: TestSession;
let parentFolderId: string | undefined;
let childFolderId: string | undefined;
/** The document returned by the LAST dashboard POST — the action's own
 *  re-render, which carries the outcome banner. */
let lastActionHtml = "";

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
 *  dashboard's. `<Form method="post">` inside an index route appends `?index`
 *  itself (`useFormAction`), so this IS the URL a browser click submits to. */
const DASHBOARD_ACTION = "/?index";

/** Submit one of the dashboard's own forms (urlencoded, exactly as a browser
 *  would) and return the re-rendered document. */
async function submit(
  request: APIRequestContext,
  jwt: string,
  form: Record<string, string>,
  label: string,
): Promise<string> {
  const res = await request.post(DASHBOARD_ACTION, { headers: auth(jwt), form });
  const html = await res.text();
  expect(res.status(), `${label}: ${html.slice(0, 600)}`).toBeLessThan(400);
  return html;
}

/** Resolve folder ids by NAME through the JSON API. Ids are opaque and the
 *  markup that carries them is an implementation detail; the UI assertions
 *  below are what pin the rendered sidebar. */
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

/** Everything inside the `<details>` sharing menu for a named folder. The
 *  summary's accessible name is an ATTRIBUTE (`aria-label`), not text — React
 *  SSR splits `text {expression}` with a comment node, so an attribute is the
 *  only stable hook. Menus never nest, so the next `</details>` closes this
 *  one and bounds the slice exactly. */
function menuMarker(folderName: string): string {
  return `aria-label="Sharing options for ${folderName}"`;
}

function sharingMenu(html: string, folderName: string): string {
  const start = html.indexOf(menuMarker(folderName));
  expect(start, `no sharing menu rendered for "${folderName}"`).toBeGreaterThan(-1);
  const end = html.indexOf("</details>", start);
  return html.slice(start, end === -1 ? html.length : end);
}

/** The badge a folder row renders. The row is `<a …>…name…</a><span …>BADGE`,
 *  so the badge is the first `<span>` text after the folder's own name. */
function badgeFor(html: string, folderName: string): string {
  const at = html.indexOf(`>${folderName}</span>`);
  expect(at, `folder "${folderName}" is not in this sidebar`).toBeGreaterThan(-1);
  const after = html.slice(at, at + 600);
  const badge = after.match(/<span class="[^"]*rounded-full[^"]*"[^>]*>([^<]*)</);
  expect(badge, `no visibility badge rendered for "${folderName}"`).not.toBeNull();
  return (badge?.[1] ?? "").trim();
}

function showsFolder(html: string, folderName: string): boolean {
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

// ── Creating folders through the sidebar's own form ─────────────────────────

When(
  "the owner creates a run-scoped parent folder from the dashboard sidebar",
  async ({ request }) => {
    // The owner's first WRITE — this is what JIT-provisions them into the
    // team domain's canonical org (their session carries a decoy org, which
    // the mirror-miss branch must ignore).
    const rootId = await folderIdByName(request, ownerSession.jwt, null);
    expect(rootId, "the org Root folder must exist (root-always-org, ADR-0076)").toBeTruthy();
    await submit(
      request,
      ownerSession.jwt,
      { intent: "new-folder", parentId: rootId as string, name: PARENT_NAME },
      "create the parent folder",
    );
    parentFolderId = await folderIdByName(request, ownerSession.jwt, PARENT_NAME);
    expect(parentFolderId, "the new parent folder must be listed for its creator").toBeTruthy();
  },
);

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

// ── The sidebar's rendered state ───────────────────────────────────────────

Then(
  "the owner's sidebar badges the parent folder {string}",
  async ({ request }, expected: string) => {
    const html = await dashboard(request, ownerSession.jwt, "", "owner dashboard");
    expect(badgeFor(html, PARENT_NAME)).toBe(expected);
  },
);

Then("the owner's sidebar renders no sharing controls for the Root folder", async ({ request }) => {
  // ADR-0076 §3: the domain rejects ANY visibility call on the Root, in either
  // direction — so the sidebar must not offer one (render-then-error is a lie).
  const html = await dashboard(request, ownerSession.jwt, "", "owner dashboard");
  expect(html, "the Root must not get a sharing kebab").not.toContain(menuMarker("Root"));
  // …while the same page DOES offer them for a manageable folder, proving the
  // absence above is the Root rule and not a page that rendered no menus.
  expect(html).toContain(menuMarker(PARENT_NAME));
});

Then("the colleague's sidebar does not show the parent folder", async ({ request }) => {
  const html = await dashboard(request, colleagueSession.jwt, "", "colleague dashboard");
  expect(
    showsFolder(html, PARENT_NAME),
    "a private folder's NAME must not reach a colleague's sidebar (ADR-0076)",
  ).toBe(false);
});

Then("the colleague's sidebar shows the parent folder", async ({ request }) => {
  const html = await dashboard(request, colleagueSession.jwt, "", "colleague dashboard");
  expect(showsFolder(html, PARENT_NAME)).toBe(true);
});

Then(
  "the colleague's sharing menu for the parent folder is refused with a reason",
  async ({ request }) => {
    // A member who can SEE a folder they don't own gets the controls disabled
    // with the server's own rule spelled out — the loader mirrors
    // `loadManagedFolder` rather than inventing a client-side rule.
    const html = await dashboard(request, colleagueSession.jwt, "", "colleague dashboard");
    const menu = sharingMenu(html, PARENT_NAME);
    // Apostrophes are HTML-escaped by React SSR, so match the plain tail.
    expect(menu).toContain("owner can change its sharing");
    expect(menu, "a non-owner must not get a live visibility toggle").not.toContain(
      "set-folder-visibility",
    );
  },
);

Then("the colleague's sidebar no longer shows the parent folder", async ({ request }) => {
  const html = await dashboard(request, colleagueSession.jwt, "", "colleague dashboard");
  expect(showsFolder(html, PARENT_NAME)).toBe(false);
});

Then("the colleague's sidebar still shows the child folder", async ({ request }) => {
  // THE GAP, made visible: the child is still org-visible, and because its
  // parent is now invisible to the colleague it grafts under Root — its name
  // leaks from a folder its owner believes they just made private.
  const html = await dashboard(request, colleagueSession.jwt, "", "colleague dashboard");
  expect(
    showsFolder(html, CHILD_NAME),
    "ADR-0076's repair is per-folder: an already-org descendant survives the parent going private",
  ).toBe(true);
});

Then(
  "the colleague's sidebar shows neither the parent nor the child folder",
  async ({ request }) => {
    const html = await dashboard(request, colleagueSession.jwt, "", "colleague dashboard");
    expect(showsFolder(html, PARENT_NAME)).toBe(false);
    expect(showsFolder(html, CHILD_NAME), "the cascade must reach the descendant").toBe(false);
  },
);

// ── Visibility toggles, with and without the cascade ────────────────────────

When(
  "the owner shares the parent folder with the whole org from the sidebar",
  async ({ request }) => {
    lastActionHtml = await submit(
      request,
      ownerSession.jwt,
      { intent: "set-folder-visibility", folderId: parentFolderId as string, visibility: "org" },
      "share the parent folder org-wide",
    );
  },
);

When(
  "the owner shares the child folder with the whole org from the sidebar",
  async ({ request }) => {
    lastActionHtml = await submit(
      request,
      ownerSession.jwt,
      { intent: "set-folder-visibility", folderId: childFolderId as string, visibility: "org" },
      "share the child folder org-wide",
    );
  },
);

When("the owner makes the parent folder private WITHOUT the cascade", async ({ request }) => {
  lastActionHtml = await submit(
    request,
    ownerSession.jwt,
    { intent: "set-folder-visibility", folderId: parentFolderId as string, visibility: "private" },
    "make the parent folder private (no cascade)",
  );
});

When("the owner makes the parent folder private WITH the cascade", async ({ request }) => {
  // `cascade=on` is exactly what the checkbox submits.
  lastActionHtml = await submit(
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

Then("the cascade result names the child folder as changed", async () => {
  // Honest reporting: the banner names what it actually changed, and would
  // name (with the server's reason) anything it could not.
  expect(lastActionHtml).toContain("applied to 1 folder inside");
  expect(lastActionHtml).toContain(CHILD_NAME);
  expect(lastActionHtml, "nothing failed, so nothing may be reported as failed").not.toContain(
    "NOT changed",
  );
});

// ── Person shares ──────────────────────────────────────────────────────────

When(
  "the owner shares the parent folder with the colleague's email from the sidebar",
  async ({ request }) => {
    lastActionHtml = await submit(
      request,
      ownerSession.jwt,
      {
        intent: "share-folder",
        folderId: parentFolderId as string,
        email: COLLEAGUE_EMAIL,
      },
      "share the parent folder by email",
    );
  },
);

When("the owner removes the colleague's share from the sidebar", async ({ request }) => {
  lastActionHtml = await submit(
    request,
    ownerSession.jwt,
    { intent: "unshare-folder", folderId: parentFolderId as string, email: COLLEAGUE_EMAIL },
    "remove the colleague's share",
  );
});

Then(
  "the owner's share roster for the parent folder lists the colleague's email",
  async ({ request }) => {
    // `?manage=<id>` is what the "Manage who it's shared with →" link opens, and
    // the only thing that makes the loader fetch a roster.
    const html = await dashboard(
      request,
      ownerSession.jwt,
      `?manage=${parentFolderId}`,
      "owner dashboard (managing)",
    );
    const menu = sharingMenu(html, PARENT_NAME);
    expect(menu).toContain(COLLEAGUE_EMAIL);
    expect(menu, "the out-of-org inert-share warning must be shown next to the field").toContain(
      "folder listings are org-scoped",
    );
  },
);

Then(
  "the owner's managed sidebar badges the parent folder {string}",
  async ({ request }, expected: string) => {
    // "Shared with N" is only derivable where the roster was actually loaded —
    // the loader pays for exactly one, the folder in `?manage=<id>`. Everywhere
    // else the badge honestly falls back to Private/Org.
    const html = await dashboard(
      request,
      ownerSession.jwt,
      `?manage=${parentFolderId}`,
      "owner dashboard (managing)",
    );
    expect(badgeFor(html, PARENT_NAME)).toBe(expected);
  },
);

Then("the owner's share roster for the parent folder is empty", async ({ request }) => {
  const html = await dashboard(
    request,
    ownerSession.jwt,
    `?manage=${parentFolderId}`,
    "owner dashboard (managing)",
  );
  const menu = sharingMenu(html, PARENT_NAME);
  expect(menu).toContain("Not shared with anyone yet.");
  expect(menu).not.toContain(COLLEAGUE_EMAIL);
});

// Best-effort accumulation bound, pass or fail: delete the folders this run
// created (deepest first — a non-empty folder is refused), then the run-scoped
// users. `cleanupTeamFixture` never throws; a hiccup logs rather than masking
// the scenario.
After({ tags: "@run-scoped" }, async ({ request }) => {
  const secretKey = process.env.E2E_CLERK_SECRET_KEY;
  if (!secretKey) return;
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
});
