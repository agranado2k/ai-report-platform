// Actor-resolution seam (server-only). The API route depends on this, NOT on a
// concrete auth scheme — so Phase 1's fixed dev identity and the real API-key /
// Clerk resolution (Phase 1.5+, ADR-0005) are interchangeable behind one port.
//
// Contract: request → Result<UploadActor, AppError>. A missing/invalid credential
// is Unauthenticated (401); a valid credential lacking the scope is
// InsufficientScope (403). Phase 1 has no credentials yet, so we return the
// seeded DEMO_ACTOR (which carries `reports:write`).
import { getAuth as clerkGetAuth } from "@clerk/remix/ssr.server";
import type { LoaderFunctionArgs } from "@remix-run/node";
import type { UploadActor } from "arp-application";
import { type AppError, err, ok, type Result } from "arp-domain";
import { defineEnv } from "arp-env";
import { DEMO_ACTOR } from "./container.server";

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

/** The scope POST /api/v1/reports requires (ADR-0039 / openapi `reports:write`). */
const REQUIRED_SCOPE = "reports:write";

/**
 * Resolve the acting principal for a write request. Phase 1: the fixed dev
 * identity. The signature is the seam — when API keys land, this parses the
 * `Authorization` header, looks up the key, and maps to its org/folder/scopes,
 * returning Unauthenticated / InsufficientScope without the route changing.
 */
export async function resolveUploadActor(
  _request: Request,
): Promise<Result<UploadActor, AppError>> {
  const actor = DEMO_ACTOR;
  if (!actor.scopes.includes(REQUIRED_SCOPE)) {
    return err({
      kind: "InsufficientScope",
      message: `missing required scope '${REQUIRED_SCOPE}'`,
      scope: REQUIRED_SCOPE,
    });
  }
  return ok(actor);
}
