// Mint a real Clerk session JWT for a seeded test user via the Clerk backend
// REST API (createSession → session token). The @auth e2e uses this to
// exercise the authenticated upload path without a browser sign-in (ADR-0048) —
// `POST /api/v1/reports` is a machine API, so the token is sent as an
// `Authorization: Bearer` header (the header path skips the dev-instance
// dev-browser requirement that rejects a bare session cookie). Raw fetch keeps
// @clerk/backend out of the dependency tree.
//
// The backend-minted session carries no active org (org selection is a FAPI
// concern), so provisioning hits the JIT path — which is exactly why
// ClerkBackendOrgProvisioner (personal orgs) and the ADR-0068 §3 team-org
// join-or-create are both idempotent (each reuses/joins the right org instead
// of minting a duplicate each run).
//
// ADR-0068 §6: the two-identity fixture. `silver+clerk_test@agranado.com` is a
// SECOND hand-provisioned test-mode address on the same dev Clerk instance
// (Clerk `+clerk_test` addresses always verify with the fixed code `424242`,
// no real inbox needed). Its domain `agranado.com` is NOT on the public-provider
// list, so it resolves to a `team` org — see `tests/e2e/README.md` for the full
// fixture writeup (identifiers, expected org, reconstruction steps).

const CLERK_API = "https://api.clerk.com/v1";

export interface TestSession {
  /** A signed session JWT (carries the `email` custom claim, ADR-0048). */
  readonly jwt: string;
  /** The test user's Clerk user id (for asserting server-side resolution). */
  readonly userId: string;
}

async function clerkFetch(path: string, secretKey: string, init?: RequestInit): Promise<Response> {
  return fetch(`${CLERK_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secretKey}`, ...(init?.headers ?? {}) },
  });
}

/**
 * Mint a session token for a test user by email, given a Clerk secret key.
 * The general-purpose primitive `mintTestSession` wraps for the primary
 * (`E2E_TEST_USER_EMAIL`) fixture; `mintTestSessionFor` lets a scenario mint
 * one for a SPECIFIC address — e.g. the ADR-0068 §6 second identity — without
 * relying on env-var plumbing per fixture.
 *
 * `activeOrganizationId` (optional) is passed through to Clerk's
 * `POST /v1/sessions` `active_organization_id` parameter (verified live
 * against the dev instance): the session then carries that org as its active
 * org, and the minted JWT's v2 `o.id` claim surfaces it to the app's
 * `getAuth` as the session org — letting a scenario exercise the
 * session-carries-an-org paths (e.g. the read path's direct org resolution)
 * that a bare backend-minted session (no org context) never hits.
 */
export async function mintTestSessionFor(
  secretKey: string,
  email: string,
  activeOrganizationId?: string,
): Promise<TestSession> {
  const form = { "Content-Type": "application/x-www-form-urlencoded" };

  const usersRes = await clerkFetch(`/users?email_address=${encodeURIComponent(email)}`, secretKey);
  if (!usersRes.ok) throw new Error(`clerk users lookup failed: ${usersRes.status}`);
  const users = (await usersRes.json()) as ReadonlyArray<{ id: string }>;
  const userId = users[0]?.id;
  if (!userId) throw new Error(`no Clerk user for ${email}`);

  const sessionParams = new URLSearchParams({ user_id: userId });
  if (activeOrganizationId) sessionParams.set("active_organization_id", activeOrganizationId);
  const sessionRes = await clerkFetch("/sessions", secretKey, {
    method: "POST",
    headers: form,
    body: sessionParams,
  });
  if (!sessionRes.ok) throw new Error(`clerk createSession failed: ${sessionRes.status}`);
  const sessionId = ((await sessionRes.json()) as { id: string }).id;

  const tokenRes = await clerkFetch(`/sessions/${sessionId}/tokens`, secretKey, {
    method: "POST",
    headers: form,
    body: new URLSearchParams({ expires_in_seconds: "600" }),
  });
  if (!tokenRes.ok) throw new Error(`clerk session token failed: ${tokenRes.status}`);
  const jwt = ((await tokenRes.json()) as { jwt: string }).jwt;

  return { jwt, userId };
}

/**
 * Mint a session token for the seeded PRIMARY test user. Requires
 * `E2E_CLERK_SECRET_KEY` (staging `sk_test_…`) and `E2E_TEST_USER_EMAIL`; the
 * `@auth` scenario is grep'd out when they're absent (see playwright.config.ts),
 * so this throwing on a missing env only fires when the suite was
 * misconfigured to run it.
 */
export async function mintTestSession(): Promise<TestSession> {
  const secretKey = process.env.E2E_CLERK_SECRET_KEY;
  const email = process.env.E2E_TEST_USER_EMAIL;
  if (!secretKey || !email) {
    throw new Error("@auth e2e needs E2E_CLERK_SECRET_KEY + E2E_TEST_USER_EMAIL");
  }
  return mintTestSessionFor(secretKey, email);
}

/**
 * Mint a session token for the ADR-0068 §6 SECOND identity (the team-org
 * colleague fixture), by email rather than a dedicated env var — the address
 * itself is stable, documented, hand-provisioned fixture data (see
 * `tests/e2e/README.md`), not a secret. Still needs `E2E_CLERK_SECRET_KEY`
 * (same dev instance as the primary fixture). Threw the same way as
 * `mintTestSession` when the secret is absent, so a scenario using this is
 * grep'd out under the same `@auth` gate.
 */
export async function mintSecondTestSession(): Promise<TestSession> {
  const secretKey = process.env.E2E_CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("@auth e2e needs E2E_CLERK_SECRET_KEY");
  }
  return mintTestSessionFor(secretKey, SECOND_FIXTURE_EMAIL);
}

/** ADR-0068 §6 — the hand-provisioned second identity (Clerk test-mode address,
 *  verification code 424242). See `tests/e2e/README.md`. */
export const SECOND_FIXTURE_EMAIL = "silver+clerk_test@agranado.com";

/** The corporate domain the team-org scenarios exercise (NOT on the
 *  public-provider list, so it resolves to a `team` org — ADR-0068 §1). */
export const TEAM_ORG_DOMAIN = "agranado.com";

/** A RUN-SCOPED team-fixture address (ADR-0074 shared-team-org scenario):
 *  `<prefix>-<runId>+clerk_test@agranado.com`. Fresh identities per run are
 *  the contamination fix from PR #222 round 3: a REUSED fixture can carry a
 *  poisoned mirror from an earlier run / older code in the (persistent,
 *  prod-forked) preview DB branch, and ADR-0074's sticky-after-mirror policy
 *  then CORRECTLY honors that mirror forever — masking the canonical chain
 *  this scenario exists to prove. A user that didn't exist before this run
 *  cannot be mirrored anywhere, on any branch state. Keeps `+clerk_test`
 *  (test-mode: no real inbox, code 424242) and the team domain. */
export function runScopedTeamEmail(prefix: string, runId: string): string {
  return `${prefix}-${runId}+clerk_test@${TEAM_ORG_DOMAIN}`;
}

/** What `ensureTeamFixtureUser` provisioned — the ids the cleanup hook needs. */
export interface TeamFixture {
  readonly email: string;
  readonly userId: string;
  /** The pending-session-heal decoy org (null when the user already had a
   *  membership — never the case for a run-scoped identity). */
  readonly decoyOrgId: string | null;
}

/**
 * Find-or-create a team-fixture user on the dev Clerk instance (idempotent:
 * every step short-circuits once its state exists). Creation marks the address
 * verified (`skip_password_requirement` + a pre-verified email) — a `+clerk_test`
 * test-mode address on a dev instance, so no real inbox is involved. The
 * webhook doesn't fire into e2e (the dev instance's Svix endpoint targets no
 * preview), so the scenario exercises the first-WRITE JIT join path — the
 * webhook's chain is the same code (resolveCanonicalTeamOrg), unit-tested.
 *
 * PENDING-SESSION HEAL (the PR #222 round-2 CI 401): the dev instance runs
 * `force_organization_selection: true` (same as prod), and Clerk gives a user
 * with ZERO org memberships a **pending** session (`tasks:
 * [{key: "choose-organization"}]`) — its JWT carries `sts: "pending"`, which
 * @clerk/backend treats as signed-out, so every request 401s at the cascade's
 * end. In prod the ADR-0074 webhook pre-joins the user before they ever sign
 * in; the e2e preview gets no webhook, so we replicate what the forced task
 * itself would produce: a self-created DECOY org (anchorless, exactly like the
 * duplicate a forced user creates in the browser). That flips the session to
 * `active` — Clerk then auto-activates the sole membership, so the session
 * CARRIES the decoy as its active org — and makes the scenario faithfully
 * reproduce the production shape the sticky-after-mirror policy must handle:
 * the app must IGNORE the (unmirrored) decoy and land the user in the domain's
 * canonical org.
 */
export async function ensureTeamFixtureUser(
  secretKey: string,
  email: string,
): Promise<TeamFixture> {
  const found = await clerkFetch(`/users?email_address=${encodeURIComponent(email)}`, secretKey);
  if (!found.ok) throw new Error(`clerk users lookup failed: ${found.status}`);
  const users = (await found.json()) as ReadonlyArray<{ id: string }>;
  let userId = users[0]?.id;

  if (!userId) {
    const created = await clerkFetch("/users", secretKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email_address: [email],
        skip_password_requirement: true,
      }),
    });
    if (!created.ok) {
      throw new Error(
        `clerk create team-fixture user ${email} failed: ${created.status} — if user creation ` +
          "is restricted on this instance, see tests/e2e/README.md (run-scoped team fixtures)",
      );
    }
    userId = ((await created.json()) as { id: string }).id;
  }

  // The pending-session heal (see the doc comment): a zero-membership user
  // cannot mint a usable session under force_organization_selection.
  const memberships = await clerkFetch(
    `/users/${userId}/organization_memberships?limit=1`,
    secretKey,
  );
  if (!memberships.ok) {
    throw new Error(`clerk membership lookup failed for ${email}: ${memberships.status}`);
  }
  const page = (await memberships.json()) as { data?: ReadonlyArray<unknown> };
  if ((page.data ?? []).length > 0) return { email, userId, decoyOrgId: null };

  const localPart = email.split("@")[0] ?? "fixture";
  const decoy = await clerkFetch("/organizations", secretKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Deliberately NO publicMetadata.domain anchor: the anchor scan must never
    // adopt this org — it plays the role of the forced task's duplicate.
    body: JSON.stringify({ name: `arp-e2e-decoy-${localPart}`, created_by: userId }),
  });
  if (!decoy.ok) {
    throw new Error(
      `clerk create decoy org for ${email} failed: ${decoy.status} — without at least one ` +
        "membership the instance's force_organization_selection makes every session PENDING " +
        "(sts:'pending' → 401). See tests/e2e/README.md (run-scoped team fixtures).",
    );
  }
  const decoyOrgId = ((await decoy.json()) as { id: string }).id;
  return { email, userId, decoyOrgId };
}

/**
 * Best-effort cleanup for a run-scoped team fixture (the accumulation bound):
 * deletes the Clerk user (which removes its memberships — keeping the shared
 * canonical org's member count flat across runs) and its decoy org. NEVER
 * throws — a cleanup failure must not fail (or mask) the scenario; it logs
 * loudly instead, and a leaked user is caught by the periodic sweep
 * (follow-up; see the PR). A 404 is success (already cleaned / retried).
 */
export async function cleanupTeamFixture(secretKey: string, fixture: TeamFixture): Promise<void> {
  const results: string[] = [];
  const del = async (path: string, label: string) => {
    try {
      const res = await clerkFetch(path, secretKey, { method: "DELETE" });
      if (!res.ok && res.status !== 404) results.push(`${label}: HTTP ${res.status}`);
    } catch (e) {
      results.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await del(`/users/${fixture.userId}`, `user ${fixture.email}`);
  if (fixture.decoyOrgId) await del(`/organizations/${fixture.decoyOrgId}`, "decoy org");
  if (results.length > 0) {
    console.warn(
      `team-fixture cleanup incomplete (will accumulate on the dev instance until swept): ${results.join("; ")}`,
    );
  }
}

/**
 * The Clerk org id of the user's membership whose `publicMetadata.domain`
 * anchor equals `domain` (ADR-0074's canonical team org), or null when the
 * user holds no such membership. Read-only BAPI lookup — used by the
 * shared-team-org scenario to (a) assert the Clerk-side auto-join actually
 * happened after the first write, and (b) re-mint the session with that org
 * active for the org-scoped listing read.
 */
export async function findAnchoredOrgMembership(
  secretKey: string,
  email: string,
  domain: string,
): Promise<string | null> {
  const usersRes = await clerkFetch(`/users?email_address=${encodeURIComponent(email)}`, secretKey);
  if (!usersRes.ok) throw new Error(`clerk users lookup failed: ${usersRes.status}`);
  const users = (await usersRes.json()) as ReadonlyArray<{ id: string }>;
  const userId = users[0]?.id;
  if (!userId) throw new Error(`no Clerk user for ${email}`);

  const membershipsRes = await clerkFetch(
    `/users/${userId}/organization_memberships?limit=20`,
    secretKey,
  );
  if (!membershipsRes.ok) {
    throw new Error(`clerk membership lookup failed: ${membershipsRes.status}`);
  }
  const memberships = (await membershipsRes.json()) as {
    data?: ReadonlyArray<{
      organization: { id: string; public_metadata?: { domain?: unknown } };
    }>;
  };
  const match = (memberships.data ?? []).find(
    (m) => m.organization.public_metadata?.domain === domain.toLowerCase(),
  );
  return match?.organization.id ?? null;
}

/**
 * Mint a Clerk **sign-in ticket** (`POST /sign_in_tokens`) for a user by
 * email, given a Clerk secret key. Unlike `mintTestSessionFor` (a backend
 * session JWT sent as a Bearer header, for machine/API calls), this is the
 * token a real BROWSER exchanges for a session client-side, via
 * `@clerk/testing`'s `clerk.signIn({ page, signInParams: { strategy:
 * 'ticket', ticket } })` — the browser's own `Clerk.client.signIn.create`
 * consumes it and calls `Clerk.setActive`, so the resulting session (cookies,
 * `window.Clerk.user`, etc.) is indistinguishable from an interactive sign-in.
 *
 * Deliberately NOT using `@clerk/testing`'s built-in `clerk.signIn({
 * emailAddress })` convenience path: that helper reads `process.env.
 * CLERK_SECRET_KEY` directly (hardcoded name, no override), which doesn't
 * match this repo's `E2E_CLERK_SECRET_KEY` convention. Minting the ticket
 * ourselves — same `clerkFetch` primitive as `mintTestSessionFor` — keeps one
 * env-var naming scheme and needs no second secret.
 */
export async function mintSignInTicketFor(secretKey: string, email: string): Promise<string> {
  const form = { "Content-Type": "application/x-www-form-urlencoded" };

  const usersRes = await clerkFetch(`/users?email_address=${encodeURIComponent(email)}`, secretKey);
  if (!usersRes.ok) throw new Error(`clerk users lookup failed: ${usersRes.status}`);
  const users = (await usersRes.json()) as ReadonlyArray<{ id: string }>;
  const userId = users[0]?.id;
  if (!userId) throw new Error(`no Clerk user for ${email}`);

  const ticketRes = await clerkFetch("/sign_in_tokens", secretKey, {
    method: "POST",
    headers: form,
    body: new URLSearchParams({ user_id: userId }),
  });
  if (!ticketRes.ok) throw new Error(`clerk sign_in_tokens failed: ${ticketRes.status}`);
  const token = ((await ticketRes.json()) as { token: string }).token;
  return token;
}

/**
 * Mint a sign-in ticket for the seeded PRIMARY test user — same env contract
 * as `mintTestSession()` (`E2E_CLERK_SECRET_KEY` + `E2E_TEST_USER_EMAIL`), so
 * the `@browser` scenario is grep'd out under the same gate when either is
 * absent (see playwright.config.ts).
 */
export async function mintPrimarySignInTicket(): Promise<string> {
  const secretKey = process.env.E2E_CLERK_SECRET_KEY;
  const email = process.env.E2E_TEST_USER_EMAIL;
  if (!secretKey || !email) {
    throw new Error("@browser e2e needs E2E_CLERK_SECRET_KEY + E2E_TEST_USER_EMAIL");
  }
  return mintSignInTicketFor(secretKey, email);
}
