// Actor-resolution seam (server-only). The API route depends on this, NOT on a
// concrete auth scheme — so the unauthenticated Phase-1 dev identity and the real
// Clerk-session resolution (ADR-0005 / ADR-0048) are interchangeable behind one
// port.
//
// Contract: request args → Result<UploadActor, AppError>. Slice 1b-ii makes this
// ADDITIVE: a signed-in Clerk session is provisioned into an org-scoped actor; an
// unauthenticated request still falls back to the seeded DEMO_ACTOR so the smoke
// + anonymous paths keep working. The flip (drop DEMO_ACTOR, require a session)
// is a later slice.
import { getAuth as clerkGetAuth } from "@clerk/remix/ssr.server";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { provisionIdentity, type UploadActor } from "arp-application";
import { type AppError, ok, type Result } from "arp-domain";
import { defineEnv } from "arp-env";
import { DEMO_ACTOR, ensureDevIdentity, provisionDeps } from "./container.server";

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
 * Resolve the acting principal for a write request (ADR-0048).
 *
 * - Signed-in Clerk session → provision (or look up) the mirrored identity and
 *   attribute the upload to that user's personal org (`reports:write` on it).
 * - Unauthenticated → the seeded DEMO_ACTOR (additive fallback, see file header).
 *
 * The user's email rides on a custom Clerk session-token claim (ADR-0048 — the
 * default claims omit it). Until that claim is configured on the instance we
 * can't safely provision, so we fall back to DEMO_ACTOR rather than break uploads.
 */
export async function resolveUploadActor(
  args: LoaderFunctionArgs,
): Promise<Result<UploadActor, AppError>> {
  const { userId, orgId, sessionClaims } = await getAuth(args);

  if (userId) {
    const email = readEmailClaim(sessionClaims);
    if (email) {
      return provisionIdentity(provisionDeps(), {
        clerkUserId: userId,
        clerkOrgId: orgId ?? null,
        email,
      });
    }
    // Signed in but no email claim → a misconfiguration (the custom session-token
    // claim isn't set on this Clerk instance yet, ADR-0048), NOT normal anonymous
    // traffic. Fall back to DEMO_ACTOR so uploads don't 500, but warn — otherwise
    // authenticated reports land in the demo identity invisibly.
    console.warn(
      `resolveUploadActor: signed-in user ${userId} has no 'email' session claim; ` +
        "attributing upload to DEMO_ACTOR. Add the email claim on the Clerk instance (ADR-0048).",
    );
  }

  // Unauthenticated (or the misconfiguration above): keep the FK targets valid
  // and attribute to the dev identity.
  await ensureDevIdentity();
  return ok(DEMO_ACTOR);
}

/** Read the `email` custom claim off a Clerk session token, if present + plausible. */
function readEmailClaim(claims: unknown): string | null {
  if (claims && typeof claims === "object" && "email" in claims) {
    const value = (claims as { email?: unknown }).email;
    if (typeof value === "string" && /^[^@\s]+@[^@\s]+$/.test(value)) return value;
  }
  return null;
}
