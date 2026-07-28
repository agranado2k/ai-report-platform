// The edit-token ACCEPTANCE seam (ADR-0063) — the trust-boundary counterpart
// to open-report.server.ts's mint. A canWrite user's app-minted, slug-bound,
// scope:"edit" token (packages/domain/src/edit-token.ts) is the alternative
// credential a slug-bound report request can carry instead of a Clerk
// session. Verifying the token's SIGNATURE is necessary but NOT sufficient:
// the token's mere existence doesn't prove the holder can still write today
// (their grant may have been revoked since mint, ADR-0060 §4) — so every
// accept re-runs `loadWritableReport` LIVE against current DB state, the
// EXACT SAME canWrite gate every other write use case (rename/move/re-upload)
// is authorized by. Deliberately factored out of auth.server.ts (which
// resolveActorForRead/resolveUploadActor delegate to) so this
// SECURITY-CRITICAL decision is unit-testable with injected fakes — no
// Clerk SDK / env wiring required (see edit-token-actor.server.test.ts).
//
// Fail-closed at every step; never throws. Structurally scoped to slug-bound
// operations: the caller only invokes this with the ROUTE's own `:slug`
// param (see auth.server.ts's wiring) — a route with no slug segment never
// calls this at all, so it can never become a general Clerk bypass for
// unrelated routes (e.g. /api/v1/keys).
import {
  loadWritableReport,
  type ReportRepository,
  type TenancyActor,
  type WriteGrantCheckDeps,
} from "arp-application";
import { type FolderId, makeSlug, readEditToken, userId as toUserId } from "arp-domain";

/** The resolved actor for an accepted edit token: `TenancyActor` (exactly the
 *  shape `loadWritableReport` itself needs) PLUS the report's CURRENT
 *  `folderId` — read off the SAME live row the canWrite re-check already
 *  loaded, so a future write-path caller (a save endpoint) can build a full
 *  `UploadActor` without a second report lookup. This is the report's REAL
 *  current folder, never a fabricated placeholder. */
export interface EditTokenActor extends TenancyActor {
  readonly folderId: FolderId;
}

export interface EditTokenActorDeps {
  readonly reports: ReportRepository;
  readonly writeGrant: WriteGrantCheckDeps;
  /** The shared HMAC secret — the SAME one open-report.server.ts mints
   *  under. Undefined when private viewing isn't configured (previews/dev):
   *  then NO token is ever trusted, fail closed. */
  readonly secret: string | undefined;
  /** epoch seconds (injectable for tests). */
  readonly nowSeconds: () => number;
}

/** Extract a bearer token from `Authorization: Bearer <token>`, or null when
 *  the header is absent, uses a different scheme, or the value is blank.
 *  Purely header plumbing — `readEditToken`'s signature check is what
 *  actually discriminates an edit token from an `arp_` key or a Clerk OAuth
 *  JWT riding the same header. Exported: edit-token-refresh.server.ts's
 *  `resolvePresentedSession` reuses the identical extraction to independently
 *  recover the presented token's `sessionStart` for the absolute session cap
 *  (ADR-0063 amendment) — rather than duplicate this regex there. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * Resolve a slug-scoped request's `Authorization: Bearer <editToken>` into a
 * `TenancyActor` (+ the report's current `folderId`), or `null` on ANY
 * failure: missing/blank/non-Bearer Authorization, bad signature, wrong
 * secret, expired, wrong slug, wrong/missing `scope` (this is also the
 * cross-parse guard — an owner ACCESS token minted under the same secret has
 * no `scope`/`sub` fields and can never narrow into `EditClaims`, see
 * edit-token.ts's `parseEditClaims` doc), empty `sub`, a route slug that
 * doesn't even parse, a report that's missing or soft-deleted, or — the
 * LIVE re-check — the resolved user no longer passing `canWrite` (grant
 * revoked, ownership changed, or the report vanished between mint and now).
 */
export async function resolveEditTokenActor(
  request: Request,
  slug: string,
  deps: EditTokenActorDeps,
): Promise<EditTokenActor | null> {
  if (!deps.secret) return null; // no secret configured → no token is ever trusted

  const token = bearerToken(request);
  if (!token) return null;

  const claims = readEditToken(token, slug, deps.secret, deps.nowSeconds());
  if (!claims) return null; // bad sig / wrong secret / expired / wrong slug / wrong scope / empty sub

  const slugR = makeSlug(slug);
  if (!slugR.ok) return null; // the route's own slug doesn't even parse

  // Look up the report ONCE to learn its CURRENT orgId — `canWrite` itself is
  // org-agnostic (ADR-0060 §4), but `TenancyActor`'s shape requires one, and
  // we need the live row for the re-check below regardless.
  const probe = await deps.reports.findBySlug(slugR.value);
  if (!probe.ok || !probe.value || probe.value.deletedAt !== null) return null;

  const candidate: TenancyActor = { orgId: probe.value.orgId, userId: toUserId(claims.sub) };

  // THE LIVE RE-CHECK (ADR-0060 §4 revocation): the token's valid signature
  // proves it was minted for a canWrite user AT MINT TIME — it says nothing
  // about NOW. Re-run the exact same gate every other write path is
  // authorized by; a write grant revoked (or ownership transferred, or the
  // report deleted) after mint rejects here.
  const writable = await loadWritableReport(deps.reports, candidate, slugR.value, deps.writeGrant);
  if (!writable.ok) return null;

  return {
    orgId: writable.value.orgId,
    userId: candidate.userId,
    folderId: writable.value.folderId,
  };
}
