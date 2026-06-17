// Mint a real Clerk session JWT for the seeded staging test user via the Clerk
// backend REST API (createSession → session token). The @auth e2e uses this to
// exercise the authenticated upload path without a browser sign-in (ADR-0048) —
// `POST /api/v1/reports` is a machine API, so a Bearer/cookie session token is
// the natural fixture. Raw fetch keeps @clerk/backend out of the dependency tree.
//
// The backend-minted session carries no active org (org selection is a FAPI
// concern), so provisioning hits the JIT path — which is exactly why
// ClerkBackendOrgProvisioner is idempotent (reuses the test user's existing org
// instead of minting a new one each run).

const CLERK_API = "https://api.clerk.com/v1";

export interface TestSession {
  /** A signed session JWT (carries the `email` custom claim, ADR-0048). */
  readonly jwt: string;
  /** The seeded test user's Clerk user id (for asserting server-side resolution). */
  readonly userId: string;
}

async function clerkFetch(path: string, secretKey: string, init?: RequestInit): Promise<Response> {
  return fetch(`${CLERK_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secretKey}`, ...(init?.headers ?? {}) },
  });
}

/**
 * Mint a session token for the seeded test user. Requires `E2E_CLERK_SECRET_KEY`
 * (staging `sk_test_…`) and `E2E_TEST_USER_EMAIL`; the `@auth` scenario is grep'd
 * out when they're absent (see playwright.config.ts), so this throwing on a
 * missing env only fires when the suite was misconfigured to run it.
 */
export async function mintTestSession(): Promise<TestSession> {
  const secretKey = process.env.E2E_CLERK_SECRET_KEY;
  const email = process.env.E2E_TEST_USER_EMAIL;
  if (!secretKey || !email) {
    throw new Error("@auth e2e needs E2E_CLERK_SECRET_KEY + E2E_TEST_USER_EMAIL");
  }
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
