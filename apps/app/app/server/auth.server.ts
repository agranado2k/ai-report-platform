// Actor-resolution seam (server-only). Upload entrypoints depend on this, NOT on
// a concrete auth scheme — so the three front doors (Clerk session, `arp_` API key,
// and a forwarded Clerk OAuth token) are interchangeable behind one port.
//
// Contract: request args → Result<UploadActor, AppError>. A write requires one of:
//   - an `arp_` API key (ADR-0008, headless),
//   - a signed-in Clerk session (ADR-0048, browser), or
//   - a Clerk OAuth access token forwarded by the MCP server (ADR-0051 amendment —
//     the MCP can't mint a session token on a production Clerk instance, so it
//     forwards the OAuth token and we verify it here with `acceptsToken:'oauth_token'`).
// Anything else is `Unauthenticated` (→ 401).
import { createClerkClient } from "@clerk/backend";
import { getAuth as clerkGetAuth } from "@clerk/remix/ssr.server";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticateApiKey, provisionIdentity, type UploadActor } from "arp-application";
import {
  type AppError,
  err,
  ok,
  type Result,
  clerkOrgId as toClerkOrgId,
  clerkUserId as toClerkUserId,
} from "arp-domain";
import { defineEnv } from "arp-env";
import { apiKeyStore, provisionDeps } from "./container.server";

/**
 * Extract an `arp_` API-key secret from `Authorization: Bearer …` (ADR-0008), or
 * null when the header is absent or carries something else (a Clerk session JWT
 * also rides this header — those start `eyJ…`, ours start `arp_`, so the prefix
 * cleanly routes the request to the API-key path vs the Clerk-session path).
 */
function apiKeyToken(args: LoaderFunctionArgs): string | null {
  const header = args.request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(arp_[A-Za-z0-9_-]+)$/.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Server-side `getAuth` wrapper (ADR-0048). Clerk's `getAuth` re-authenticates
 * the request from scratch and needs the publishable key — which it otherwise
 * reads from the `CLERK_PUBLISHABLE_KEY` env var. Our env contract names it
 * `PUBLIC_CLERK_PUBLISHABLE_KEY` (ADR-0043), so the default lookup misses it and
 * auth throws "Publishable key is missing". We pass both keys explicitly from
 * the validated env. `getAuth`'s public type only exposes `secretKey`, but
 * `loadOptions()` honours a `publishableKey` override at runtime; binding the
 * options to a variable first keeps it type-safe (no excess-property check).
 */
export function getAuth(args: LoaderFunctionArgs) {
  const env = defineEnv();
  const opts = {
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.PUBLIC_CLERK_PUBLISHABLE_KEY,
  };
  return clerkGetAuth(args, opts);
}

/** A Clerk Backend SDK client from the validated env (needs v2 for `acceptsToken`).
 *  Memoized per warm lambda — the client is stateless config, so one instance is
 *  reused across requests instead of rebuilt each call. */
let _clerk: ReturnType<typeof createClerkClient> | undefined;
function clerkBackend() {
  if (_clerk) return _clerk;
  const env = defineEnv();
  _clerk = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.PUBLIC_CLERK_PUBLISHABLE_KEY,
  });
  return _clerk;
}

/**
 * Verify the request's `Authorization` as a Clerk **OAuth access token** (the MCP
 * server forwards it — ADR-0051 amendment) → the subject user id, or null. Boundary
 * glue over `@clerk/backend`; fail-closed — an invalid/missing token returns null
 * (→ 401). The catch wraps ONLY the verification (an auth *decision*), so a Clerk
 * outage doesn't masquerade as a client 401. We pass no `audience`, so the token's
 * RFC-8707 binding to the MCP resource isn't rejected here — verifying the same
 * token at our own API is Clerk's supported multi-backend pattern.
 */
async function resolveOAuthUserId(args: LoaderFunctionArgs): Promise<string | null> {
  if (!args.request.headers.get("authorization")) return null;
  try {
    const state = await clerkBackend().authenticateRequest(args.request, {
      acceptsToken: "oauth_token",
    });
    const auth = state.toAuth();
    return auth && "userId" in auth && typeof auth.userId === "string" ? auth.userId : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the user's primary email — needed ONLY on the write/provision path (a first
 * upload mirrors the identity, ADR-0048); it isn't on the OAuth machine-auth object.
 * A Clerk outage here is infra (`Unexpected` → 500), NOT a client auth failure —
 * deliberately distinct from the verification's fail-closed 401. No email on the
 * account → `Unauthenticated` (we can't provision without one).
 */
async function fetchOAuthEmail(userId: string): Promise<Result<string, AppError>> {
  let email: string | undefined;
  try {
    const user = await clerkBackend().users.getUser(userId);
    const primary =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ??
      user.emailAddresses[0];
    email = primary?.emailAddress;
  } catch {
    // Clerk unreachable — infra, not a client auth failure (distinct from the 401).
    return err({ kind: "Unexpected", message: `failed to fetch Clerk user ${userId}` });
  }
  if (!email) {
    return err({
      kind: "Unauthenticated",
      message: "OAuth identity has no primary email; cannot provision",
    });
  }
  return ok(email);
}

/**
 * Resolve the acting principal for a write request. Tries each front door in turn:
 * `arp_` API key → Clerk session → forwarded Clerk OAuth token. The session and
 * OAuth paths both `provisionIdentity` (create the mirror on first write, ADR-0048),
 * attributing the upload to the user's personal org. No credential → `Unauthenticated`.
 */
export async function resolveUploadActor(
  args: LoaderFunctionArgs,
): Promise<Result<UploadActor, AppError>> {
  // API-key path first (ADR-0008): a Bearer `arp_…` resolves to an org-scoped
  // actor without a Clerk session. A present-but-unmatched key is `Unauthenticated`
  // (→ 401), NOT a fall-through to the session path.
  const token = apiKeyToken(args);
  if (token) {
    const resolved = await authenticateApiKey({ apiKeys: apiKeyStore() }, token);
    if (!resolved.ok) return resolved;
    if (!resolved.value) {
      return err({ kind: "Unauthenticated", message: "invalid or revoked API key" });
    }
    return ok(resolved.value);
  }

  // Clerk session path (ADR-0048): a browser sign-in carries the email custom claim.
  const { userId, orgId, sessionClaims } = await getAuth(args);
  if (userId) {
    const email = readEmailClaim(sessionClaims);
    if (!email) {
      console.warn(
        `resolveUploadActor: signed-in user ${userId} has no 'email' session claim — ` +
          "rejecting. Configure the email claim on the Clerk instance (ADR-0048).",
      );
      return err({ kind: "Unauthenticated", message: "session is missing the email claim" });
    }
    return provisionIdentity(provisionDeps(), {
      clerkUserId: toClerkUserId(userId),
      clerkOrgId: orgId ? toClerkOrgId(orgId) : null,
      email,
    });
  }

  // Forwarded Clerk OAuth token path (ADR-0051 amendment). No active org rides an
  // OAuth token, so attribute to the user's personal org (created on first write).
  // Email is fetched only here (the write path) — reads don't pay that round-trip.
  const oauthUserId = await resolveOAuthUserId(args);
  if (oauthUserId) {
    const email = await fetchOAuthEmail(oauthUserId);
    if (!email.ok) return email; // no email → Unauthenticated (401); Clerk outage → Unexpected (500)
    const deps = provisionDeps();
    const personal = await deps.clerkOrgs.findPersonalOrg(oauthUserId);
    if (!personal.ok) return personal; // Clerk outage → propagate (→ 500)
    return provisionIdentity(deps, {
      clerkUserId: toClerkUserId(oauthUserId),
      clerkOrgId: personal.value ? toClerkOrgId(personal.value) : null,
      email: email.value,
    });
  }

  return err({
    kind: "Unauthenticated",
    message: "a session, API key, or OAuth token is required",
  });
}

/**
 * Resolve the acting principal for a READ (the dashboard list, the API-keys
 * settings page) WITHOUT the write-path side effects. Unlike `resolveUploadActor`,
 * this never provisions: it looks up the already-mirrored identity (`findByClerk`)
 * and returns its `userId`/`orgId`, or `null` when there's no credential / the user
 * isn't mirrored yet (a brand-new user who hasn't uploaded — their list is simply
 * empty). Keeps GET loaders safe/idempotent: no Clerk org or DB rows are created on
 * a read. `userId` is exposed (not just `orgId`) so read loaders that key off the
 * acting user — e.g. listing that user's API keys — needn't take the write path.
 */
export async function resolveActorForRead(
  args: LoaderFunctionArgs,
): Promise<Result<Pick<UploadActor, "userId" | "orgId"> | null, AppError>> {
  // API-key path first (ADR-0008): a Bearer `arp_…` resolves the principal. An
  // unmatched key reads as `null` (empty list), consistent with no-session reads.
  const token = apiKeyToken(args);
  if (token) {
    const resolved = await authenticateApiKey({ apiKeys: apiKeyStore() }, token);
    if (!resolved.ok) return resolved;
    return ok(
      resolved.value ? { userId: resolved.value.userId, orgId: resolved.value.orgId } : null,
    );
  }

  const { userId, orgId } = await getAuth(args);
  if (userId) return lookupMirroredActor(userId, orgId ?? null);

  // Forwarded Clerk OAuth token (ADR-0051 amendment) — read-only lookup of the
  // already-mirrored identity. Verify only (no email round-trip on a read).
  const oauthUserId = await resolveOAuthUserId(args);
  if (oauthUserId) return lookupMirroredActor(oauthUserId, null);

  return ok(null); // no credential → genuinely unauthenticated
}

/**
 * Read-only resolve of an already-mirrored actor from a Clerk user id. The session/
 * OAuth token may carry NO active org; the user still has a personal org (the one
 * the write path provisioned on first upload, ADR-0048). Resolve it so reads see the
 * same org writes attribute to, WITHOUT provisioning on a GET. Returns `null` when
 * the user has no org / mirror yet (never uploaded) → empty list.
 */
async function lookupMirroredActor(
  clerkUserId: string,
  activeOrgId: string | null,
): Promise<Result<Pick<UploadActor, "userId" | "orgId"> | null, AppError>> {
  const deps = provisionDeps();
  let clerkOrgId = activeOrgId;
  if (!clerkOrgId) {
    const personal = await deps.clerkOrgs.findPersonalOrg(clerkUserId);
    if (!personal.ok) return personal; // infra failure (Clerk outage) → propagate (→ 500)
    clerkOrgId = personal.value;
  }
  if (!clerkOrgId) return ok(null); // signed in but no org yet (never uploaded) → empty

  const found = await deps.identities.findByClerk(clerkUserId, clerkOrgId);
  if (!found.ok) return found; // infra failure (DB outage) → propagate (→ 500)
  return ok(found.value ? { userId: found.value.userId, orgId: found.value.orgId } : null);
}

/** Read the `email` custom claim off a Clerk session token, if present + plausible. */
function readEmailClaim(claims: unknown): string | null {
  if (claims && typeof claims === "object" && "email" in claims) {
    const value = (claims as { email?: unknown }).email;
    if (typeof value === "string" && /^[^@\s]+@[^@\s]+$/.test(value)) return value;
  }
  return null;
}
