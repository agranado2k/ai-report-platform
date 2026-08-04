// Live wiring for the actor-resolution seam (server-only). The CASCADE itself —
// the four front doors (`arp_` API key → Clerk session → forwarded Clerk OAuth
// token → slug-bound edit token), their order, terminal-vs-fall-through rules,
// the read/write differences (JIT provisioning on write + on a session read's
// mirror miss, ADR-0048 amendment; null-vs-401), and
// the STRUCTURAL slug gate on the edit-token door — lives in resolve-actor.
// server.ts, where it is unit-tested with every door injected. This module only
// builds the REAL deps from the composition root (container.server.ts) and the
// Clerk SDK, and keeps `resolveUploadActor` / `resolveActorForRead` as the two
// mode-specific entrypoints the routes and `handle()` call.
import { createClerkClient } from "@clerk/backend";
import { getAuth as clerkGetAuth } from "@clerk/remix/ssr.server";
import type { LoaderFunctionArgs } from "@remix-run/node";
import type { UploadActor } from "arp-application";
import { type AppError, err, ok, type Result } from "arp-domain";
import { defineEnv } from "arp-env";
import { clerkDisplayName } from "./clerk-display-name";
import {
  accessTokenSecret,
  apiKeyStore,
  deps as containerDeps,
  identityStore,
  orgWriteGrantStore,
  provisionDeps,
  writeGrantStore,
} from "./container.server";
import type { EditTokenActorDeps } from "./edit-token-actor.server";
import { type Actor, type ResolveActorDeps, resolveActor } from "./resolve-actor.server";

/** Deps for the edit-token door, built from the composition root — memoized
 *  stores, freshly-read env for the secret (previews/dev may leave it unset,
 *  which fails the edit-token branch closed, see edit-token-actor.server.ts). */
function editTokenDeps(): EditTokenActorDeps {
  return {
    reports: containerDeps().reports,
    writeGrant: {
      grants: writeGrantStore(),
      orgWriteGrants: orgWriteGrantStore(),
      identities: identityStore(),
    },
    secret: accessTokenSecret(),
    nowSeconds: () => Math.floor(Date.now() / 1000),
  };
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
async function resolveOAuthUserId(request: Request): Promise<string | null> {
  if (!request.headers.get("authorization")) return null;
  try {
    const state = await clerkBackend().authenticateRequest(request, {
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
async function fetchOAuthIdentity(
  userId: string,
): Promise<Result<{ email: string; displayName: string | null }, AppError>> {
  let email: string | undefined;
  let displayName: string | null = null;
  try {
    const user = await clerkBackend().users.getUser(userId);
    // VERIFIED addresses only (review #158 H-3): under ADR-0068 the email
    // domain IS the tenancy boundary — an unverified address would let anyone
    // claim x@victim-corp.com and JIT-join that company's org. The session
    // path relies on the Clerk instance blocking unverified sign-ins (a
    // documented ADR-0068 dependency); here we can and do check explicitly.
    const verified = user.emailAddresses.filter((e) => e.verification?.status === "verified");
    const primary = verified.find((e) => e.id === user.primaryEmailAddressId) ?? verified[0];
    email = primary?.emailAddress;
    // Best-effort display name (ADR-0063 author display): the OAuth path already
    // has the full Clerk user, so we capture it here for free — no extra round-trip.
    displayName = clerkDisplayName(user);
  } catch {
    // Clerk unreachable — infra, not a client auth failure (distinct from the 401).
    return err({ kind: "Unexpected", message: `failed to fetch Clerk user ${userId}` });
  }
  if (!email) {
    return err({
      kind: "Unauthenticated",
      message: "OAuth identity has no verified email; cannot provision",
    });
  }
  return ok({ email, displayName });
}

/** The REAL four-door deps, assembled from the composition root + Clerk SDK. */
function liveResolveActorDeps(): ResolveActorDeps {
  return {
    apiKeys: apiKeyStore(),
    session: getAuth,
    provision: provisionDeps(),
    oauth: { verify: resolveOAuthUserId, fetchIdentity: fetchOAuthIdentity },
    editTokenDeps: editTokenDeps(),
  };
}

/**
 * Resolve the acting principal for a WRITE. The edit-token door is gated on the
 * route actually having a `:slug` param (passed here as the structural gate —
 * a slugless route never has that door). No credential → `Unauthenticated`.
 */
export async function resolveUploadActor(
  args: LoaderFunctionArgs,
): Promise<Result<UploadActor, AppError>> {
  return resolveActor(args, { mode: "write", slug: args.params.slug }, liveResolveActorDeps());
}

/** The read-path actor's shape (ADR-0060 §3): `userId`/`orgId` PLUS `scopes` —
 *  needed so a read-only, owner-gated use case (`listWriteGrants`) can still
 *  enforce the `acl:write` scope on a GET, same as its write siblings. */
type ReadResolvedActor = Pick<Actor, "userId" | "orgId" | "scopes">;

/**
 * Resolve the acting principal for a READ — same doors. A session-authenticated
 * read that misses the identity mirror lazily provisions through the same
 * `provisionIdentity` as the write path (ADR-0048 amendment 2026-08-01 — a
 * one-time write on first read); a credential-less request, or a session
 * without the email claim, still resolves to ok(null) (the caller renders an
 * empty list / 401s).
 */
export async function resolveActorForRead(
  args: LoaderFunctionArgs,
): Promise<Result<ReadResolvedActor | null, AppError>> {
  return resolveActor(args, { mode: "read", slug: args.params.slug }, liveResolveActorDeps());
}
