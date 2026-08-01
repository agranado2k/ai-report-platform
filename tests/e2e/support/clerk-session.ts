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
 */
export async function mintTestSessionFor(secretKey: string, email: string): Promise<TestSession> {
  const form = { "Content-Type": "application/x-www-form-urlencoded" };

  const usersRes = await clerkFetch(`/users?email_address=${encodeURIComponent(email)}`, secretKey);
  if (!usersRes.ok) throw new Error(`clerk users lookup failed: ${usersRes.status}`);
  const users = (await usersRes.json()) as ReadonlyArray<{ id: string }>;
  const userId = users[0]?.id;
  if (!userId) throw new Error(`no Clerk user for ${email}`);

  const sessionRes = await clerkFetch("/sessions", secretKey, {
    method: "POST",
    headers: form,
    body: new URLSearchParams({ user_id: userId }),
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

/** ADR-0074 — the THIRD identity, sharing the second fixture's `agranado.com`
 *  domain so the shared-team-org scenario can prove two same-domain identities
 *  land in ONE org. Unlike fixtures 1/2 this one is find-or-CREATED
 *  programmatically (`ensureThirdFixtureUser`) — code, not a clicked fixture,
 *  so it self-heals after an instance reset. See `tests/e2e/README.md`. */
export const THIRD_FIXTURE_EMAIL = "gold+clerk_test@agranado.com";

/**
 * Find-or-create the third fixture user on the dev Clerk instance (idempotent:
 * the lookup wins on every run after the first). Creation marks the address
 * verified (`skip_password_requirement` + a pre-verified email) — a `+clerk_test`
 * test-mode address on a dev instance, so no real inbox is involved. The
 * webhook doesn't fire into e2e (the dev instance's Svix endpoint targets no
 * preview), so the scenario exercises the first-WRITE JIT join path — the
 * webhook's chain is the same code (resolveCanonicalTeamOrg), unit-tested.
 */
export async function ensureThirdFixtureUser(secretKey: string): Promise<void> {
  const found = await clerkFetch(
    `/users?email_address=${encodeURIComponent(THIRD_FIXTURE_EMAIL)}`,
    secretKey,
  );
  if (!found.ok) throw new Error(`clerk users lookup failed: ${found.status}`);
  const users = (await found.json()) as ReadonlyArray<{ id: string }>;
  if (users[0]?.id) return; // already provisioned — the steady state

  const created = await clerkFetch("/users", secretKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email_address: [THIRD_FIXTURE_EMAIL],
      skip_password_requirement: true,
    }),
  });
  if (!created.ok) {
    throw new Error(
      `clerk create third-fixture user failed: ${created.status} — if user creation is ` +
        "restricted on this instance, hand-provision gold+clerk_test@agranado.com once " +
        "(see tests/e2e/README.md, fixture 3)",
    );
  }
}

/** Mint a session for the THIRD identity (ADR-0074 shared-team-org scenario),
 *  find-or-creating the user first. Same `E2E_CLERK_SECRET_KEY` gate as the
 *  other fixtures. */
export async function mintThirdTestSession(): Promise<TestSession> {
  const secretKey = process.env.E2E_CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("@auth e2e needs E2E_CLERK_SECRET_KEY");
  }
  await ensureThirdFixtureUser(secretKey);
  return mintTestSessionFor(secretKey, THIRD_FIXTURE_EMAIL);
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
