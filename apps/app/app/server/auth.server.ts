// Actor-resolution seam (server-only). Upload entrypoints depend on this, NOT on
// a concrete auth scheme — so Clerk-session resolution today and API keys later
// (ADR-0008) are interchangeable behind one port.
//
// Contract: request args → Result<UploadActor, AppError>. A write now REQUIRES a
// Clerk session (ADR-0048): a signed-in session is provisioned into an org-scoped
// actor; anything else is `Unauthenticated` (→ 401). The seeded DEMO_ACTOR and the
// additive fallback are gone — this is the flip.
import { getAuth as clerkGetAuth } from "@clerk/remix/ssr.server";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { provisionIdentity, type UploadActor } from "arp-application";
import { type AppError, err, type Result } from "arp-domain";
import { defineEnv } from "arp-env";
import { provisionDeps } from "./container.server";

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

/**
 * Resolve the acting principal for a write request (ADR-0048). Requires a Clerk
 * session:
 *
 * - Signed-in + email claim → provision (or look up) the mirrored identity and
 *   attribute the upload to that user's personal org (`reports:write` on it).
 * - No session → `Unauthenticated` (→ 401).
 * - Signed in but missing the email claim → also `Unauthenticated`, plus a warn:
 *   the custom session-token claim (ADR-0048) is misconfigured on this instance.
 *   It's configured on staging + prod, so this is a defensive guard, not a path.
 */
export async function resolveUploadActor(
  args: LoaderFunctionArgs,
): Promise<Result<UploadActor, AppError>> {
  const { userId, orgId, sessionClaims } = await getAuth(args);

  if (!userId) {
    return err({ kind: "Unauthenticated", message: "a signed-in session is required" });
  }

  const email = readEmailClaim(sessionClaims);
  if (!email) {
    console.warn(
      `resolveUploadActor: signed-in user ${userId} has no 'email' session claim — ` +
        "rejecting. Configure the email claim on the Clerk instance (ADR-0048).",
    );
    return err({ kind: "Unauthenticated", message: "session is missing the email claim" });
  }

  return provisionIdentity(provisionDeps(), {
    clerkUserId: userId,
    clerkOrgId: orgId ?? null,
    email,
  });
}

/**
 * Resolve the acting principal for a READ (the dashboard list) WITHOUT the
 * write-path side effects. Unlike `resolveUploadActor`, this never provisions:
 * it looks up the already-mirrored identity (`findByClerk`) and returns its org
 * scope, or `null` when there's no session / the user isn't mirrored yet (a
 * brand-new user who hasn't uploaded — their list is simply empty). Keeps GET
 * loaders safe/idempotent: no Clerk org or DB rows are created on a read.
 * Provisioning stays on the write path (`resolveUploadActor`, first upload).
 */
export async function resolveActorForRead(
  args: LoaderFunctionArgs,
): Promise<Pick<UploadActor, "orgId"> | null> {
  const { userId, orgId } = await getAuth(args);
  if (!userId || !orgId) return null;
  const found = await provisionDeps().identities.findByClerk(userId, orgId);
  return found.ok && found.value ? { orgId: found.value.orgId } : null;
}

/** Read the `email` custom claim off a Clerk session token, if present + plausible. */
function readEmailClaim(claims: unknown): string | null {
  if (claims && typeof claims === "object" && "email" in claims) {
    const value = (claims as { email?: unknown }).email;
    if (typeof value === "string" && /^[^@\s]+@[^@\s]+$/.test(value)) return value;
  }
  return null;
}
