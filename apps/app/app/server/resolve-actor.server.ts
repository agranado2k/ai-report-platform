// The actor-resolution module (server-only) — ONE cascade for both request
// modes, four interchangeable front doors, every door's I/O injected:
//
//   1. `arp_` API key (ADR-0008, headless)
//   2. Clerk session (ADR-0048, browser) — JIT-provisions on WRITE only
//   3. forwarded Clerk OAuth token (ADR-0051 amendment, the MCP server)
//   4. slug-bound edit token (ADR-0063) — STRUCTURALLY disabled unless the
//      caller passes the route's own `:slug` param (`opts.slug`); a route with
//      no slug segment (e.g. /api/v1/keys) has no door 4 at all, so the edit
//      token can never become a general Clerk bypass.
//
// Doors are TERMINAL once engaged: a presented-but-invalid API key is a 401
// (write) / null (read), never a fall-through to the session path; a signed-in
// session never consults OAuth; a verified OAuth subject never consults the
// edit token. Mode differences, enforced here in one place:
//   - write: doors 2+3 `provisionIdentity` (mirror on first write, ADR-0048);
//     no door matching → err(Unauthenticated) (→ 401).
//   - read: NEVER provisions (GETs stay safe/idempotent — no Clerk org or DB
//     rows created); an unmirrored/absent credential resolves to ok(null).
//
// Everything I/O-shaped rides `ResolveActorDeps`, so the whole cascade is
// unit-testable without Clerk, env, or a database (resolve-actor.server.test.ts).
// The live wiring lives in auth.server.ts (which keeps `resolveUploadActor` /
// `resolveActorForRead` as thin mode-specific delegations for its callers).
import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  type ApiKeyStore,
  type ProvisionIdentityDeps,
  provisionIdentity,
  SELF_SCOPES,
} from "arp-application";
import {
  type AppError,
  err,
  type FolderId,
  type OrgId,
  ok,
  type Result,
  clerkOrgId as toClerkOrgId,
  clerkUserId as toClerkUserId,
  type UserId,
} from "arp-domain";
import { capDisplayName } from "./clerk-display-name";
import { type EditTokenActorDeps, resolveEditTokenActor } from "./edit-token-actor.server";

/**
 * The ONE actor shape this seam resolves — structurally the application layer's
 * `UploadActor`, and a superset of every narrower shape the use cases take
 * (`TenancyActor`, the read-path `Pick<…, "userId" | "orgId" | "scopes">`):
 * adapt AT the seam, keep the application types where the use cases need them.
 * `folderId` is the actor's write target — the org Root (doors 1–3) or the
 * report's own current folder (door 4).
 */
export interface Actor {
  readonly userId: UserId;
  readonly orgId: OrgId;
  readonly folderId: FolderId;
  readonly scopes: readonly string[];
}

/** Scopes granted to an actor resolved off an edit token (ADR-0063) —
 *  deliberately just `reports:write`, NOT the full `SELF_SCOPES`: an edit
 *  token authorizes editing THIS report's content, not managing its sharing
 *  (`acl:write` — grant/revoke/setAcl/listWriteGrants all gate on that scope
 *  and must stay owner/Clerk-session-only). */
export const EDIT_TOKEN_SCOPES: readonly string[] = ["reports:write"];

export interface ResolveActorOptions {
  readonly mode: "read" | "write";
  /** The route's OWN `:slug` param. This is the structural gate on door 4:
   *  omitted/undefined → the edit-token door does not exist for this request. */
  readonly slug?: string;
}

/** What door 2 needs from Clerk's `getAuth` — the session's subject + claims. */
export interface ClerkSessionAuth {
  readonly userId: string | null;
  readonly orgId?: string | null;
  readonly sessionClaims: unknown;
}

export interface ResolveActorDeps {
  /** Door 1 — `arp_` API-key verification (ADR-0008). */
  readonly apiKeys: Pick<ApiKeyStore, "verify">;
  /** Door 2 — re-authenticate the request as a Clerk session. */
  readonly session: (args: LoaderFunctionArgs) => Promise<ClerkSessionAuth>;
  /** Doors 2+3 — the identity mirror + Clerk org provisioner: `provisionIdentity`
   *  on write (ADR-0048), read-only `findByClerk`/`findPersonalOrg` on read. */
  readonly provision: ProvisionIdentityDeps;
  /** Door 3 — forwarded Clerk OAuth token (ADR-0051 amendment). `verify` is
   *  fail-closed (invalid/missing → null → 401); `fetchIdentity` is called on
   *  the WRITE path only (provisioning needs the email — a Clerk outage there
   *  is `Unexpected` → 500, distinct from the verification 401). */
  readonly oauth: {
    verify(request: Request): Promise<string | null>;
    fetchIdentity(
      clerkUserId: string,
    ): Promise<Result<{ email: string; displayName: string | null }, AppError>>;
  };
  /** Door 4 — the edit-token acceptance deps (secret unset → fail closed). */
  readonly editTokenDeps: EditTokenActorDeps;
}

export async function resolveActor(
  args: LoaderFunctionArgs,
  opts: ResolveActorOptions & { readonly mode: "write" },
  deps: ResolveActorDeps,
  acceptEditToken?: typeof resolveEditTokenActor,
): Promise<Result<Actor, AppError>>;
export async function resolveActor(
  args: LoaderFunctionArgs,
  opts: ResolveActorOptions & { readonly mode: "read" },
  deps: ResolveActorDeps,
  acceptEditToken?: typeof resolveEditTokenActor,
): Promise<Result<Actor | null, AppError>>;
export async function resolveActor(
  args: LoaderFunctionArgs,
  opts: ResolveActorOptions,
  deps: ResolveActorDeps,
  // Door 4's acceptance fn (the standalone, unit-tested trust boundary in
  // edit-token-actor.server.ts) — injectable so the CASCADE tests don't need to
  // mint real tokens; defaults to the real boundary.
  acceptEditToken: typeof resolveEditTokenActor = resolveEditTokenActor,
): Promise<Result<Actor | null, AppError>> {
  const write = opts.mode === "write";

  // Door 1 — API key (ADR-0008): a Bearer `arp_…` resolves without a Clerk
  // session. TERMINAL: a present-but-unmatched key is Unauthenticated (write)
  // or null (read; the caller renders an empty list), never a fall-through.
  const token = apiKeyToken(args);
  if (token) {
    const resolved = await deps.apiKeys.verify(token);
    if (!resolved.ok) return resolved;
    if (!resolved.value) {
      return write
        ? err({ kind: "Unauthenticated", message: "invalid or revoked API key" })
        : ok(null);
    }
    const p = resolved.value;
    return ok({ userId: p.userId, orgId: p.orgId, folderId: p.rootFolderId, scopes: p.scopes });
  }

  // Door 2 — Clerk session (ADR-0048): a browser sign-in. TERMINAL once a
  // session subject exists. Write JIT-provisions off the email custom claim;
  // read looks up the already-mirrored identity only.
  const { userId, orgId, sessionClaims } = await deps.session(args);
  if (userId) {
    if (!write) return lookupMirroredActor(deps.provision, userId, orgId ?? null);
    const email = readEmailClaim(sessionClaims);
    if (!email) {
      console.warn(
        `resolveActor: signed-in user ${userId} has no 'email' session claim — ` +
          "rejecting. Configure the email claim on the Clerk instance (ADR-0048).",
      );
      return err({ kind: "Unauthenticated", message: "session is missing the email claim" });
    }
    return provisionIdentity(deps.provision, {
      clerkUserId: toClerkUserId(userId),
      clerkOrgId: orgId ? toClerkOrgId(orgId) : null,
      email,
      // Best-effort display name (ADR-0063): the session token's `name` custom
      // claim if the Clerk instance sets one; no backend round-trip here.
      displayName: readNameClaim(sessionClaims),
    });
  }

  // Door 3 — forwarded Clerk OAuth token (ADR-0051 amendment). TERMINAL once
  // verification yields a subject. No active org rides an OAuth token, so the
  // write path attributes to the personal org; the email round-trip is paid on
  // write only (provisioning needs it — reads don't).
  const oauthUserId = await deps.oauth.verify(args.request);
  if (oauthUserId) {
    if (!write) return lookupMirroredActor(deps.provision, oauthUserId, null);
    const identity = await deps.oauth.fetchIdentity(oauthUserId);
    if (!identity.ok) return identity; // no email → Unauthenticated (401); Clerk outage → Unexpected (500)
    const personal = await deps.provision.clerkOrgs.findPersonalOrg(oauthUserId);
    if (!personal.ok) return personal; // Clerk outage → propagate (→ 500)
    return provisionIdentity(deps.provision, {
      clerkUserId: toClerkUserId(oauthUserId),
      clerkOrgId: personal.value ? toClerkOrgId(personal.value) : null,
      email: identity.value.email,
      displayName: identity.value.displayName,
    });
  }

  // Door 4 — slug-bound edit token (ADR-0063), LAST, and ONLY on a route whose
  // own `:slug` param the caller passed (structural gate — no slug, no door).
  // Never provisions: an edit token only resolves to an ALREADY-mirrored user
  // (its `sub` was minted from a real actor.userId, and the acceptor's LIVE
  // canWrite re-check requires a real Report row). Both modes carry the same
  // deliberately-narrow EDIT_TOKEN_SCOPES.
  if (opts.slug) {
    const editActor = await acceptEditToken(args.request, opts.slug, deps.editTokenDeps);
    if (editActor) {
      return ok({
        userId: editActor.userId,
        orgId: editActor.orgId,
        folderId: editActor.folderId,
        scopes: EDIT_TOKEN_SCOPES,
      });
    }
  }

  return write
    ? err({ kind: "Unauthenticated", message: "a session, API key, or OAuth token is required" })
    : ok(null); // no credential → genuinely unauthenticated read
}

/**
 * Extract an `arp_` API-key secret from `Authorization: Bearer …` (ADR-0008), or
 * null when the header is absent or carries something else (a Clerk session JWT
 * also rides this header — those start `eyJ…`, ours start `arp_`, so the prefix
 * cleanly routes the request to door 1 vs doors 2/3).
 */
function apiKeyToken(args: LoaderFunctionArgs): string | null {
  const header = args.request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(arp_[A-Za-z0-9_-]+)$/.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Read-only resolve of an already-mirrored actor from a Clerk user id. The
 * session/OAuth token may carry NO active org; the user still has a personal
 * org (the one the write path provisioned on first upload, ADR-0048). Resolve
 * it so reads see the same org writes attribute to, WITHOUT provisioning on a
 * GET. Null when the user has no org / mirror yet (never uploaded) → empty
 * list. Session/OAuth reads aren't API-key-scoped, so they carry the same
 * `SELF_SCOPES` the write path grants (ADR-0060 §3).
 */
async function lookupMirroredActor(
  provision: ProvisionIdentityDeps,
  clerkUserId: string,
  activeOrgId: string | null,
): Promise<Result<Actor | null, AppError>> {
  let clerkOrgId = activeOrgId;
  if (!clerkOrgId) {
    const personal = await provision.clerkOrgs.findPersonalOrg(clerkUserId);
    if (!personal.ok) return personal; // infra failure (Clerk outage) → propagate (→ 500)
    clerkOrgId = personal.value;
  }
  if (!clerkOrgId) return ok(null); // signed in but no org yet (never uploaded) → empty

  const found = await provision.identities.findByClerk(clerkUserId, clerkOrgId);
  if (!found.ok) return found; // infra failure (DB outage) → propagate (→ 500)
  return ok(
    found.value
      ? {
          userId: found.value.userId,
          orgId: found.value.orgId,
          folderId: found.value.rootFolderId,
          scopes: SELF_SCOPES,
        }
      : null,
  );
}

/** Read the `email` custom claim off a Clerk session token, if present + plausible. */
function readEmailClaim(claims: unknown): string | null {
  if (claims && typeof claims === "object" && "email" in claims) {
    const value = (claims as { email?: unknown }).email;
    if (typeof value === "string" && /^[^@\s]+@[^@\s]+$/.test(value)) return value;
  }
  return null;
}

/** Read the `name` custom claim off a Clerk session token (ADR-0063 author
 *  display), if the instance sets one. Best-effort: a non-string / blank /
 *  absent claim → null (author surfaces fall back to email). Capped via the
 *  shared `capDisplayName` (claude-review #200) so this capture point matches
 *  every other one. */
function readNameClaim(claims: unknown): string | null {
  if (claims && typeof claims === "object" && "name" in claims) {
    const value = (claims as { name?: unknown }).name;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) return capDisplayName(trimmed);
    }
  }
  return null;
}
