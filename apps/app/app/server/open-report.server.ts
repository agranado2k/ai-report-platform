// The owner-open decision (GET /reports/{slug}/open) — factored out of the
// route so the SECURITY KEYSTONE is unit-testable (ADR-0059 §4 / ADR-0060
// §4, extended by ADR-0063 Phase 5): `loadWritableReport` (`isOwner OR
// hasWriteGrant`) is THE gate. EVERY canWrite user — the report's owner OR a
// write-grantee — is minted the SAME short-lived (15 min), slug-bound,
// `scope:"edit"` token (packages/domain/src/edit-token.ts) and lands in the
// SAME unified in-viewer experience (`${viewOrigin}/${slug}/edit?et=...`).
//
// Phase 5 retired the two-tier design this function used to implement: an
// owner no longer gets a separate, higher-privilege 24h `owner:true` access
// token as their PRIMARY route in — every canWrite user (owner or grantee)
// is minted the same short-lived edit token and lands in the unified
// `/edit` experience. Grep audit before that change (Phase 5 task brief)
// confirmed the owner-access token minted HERE had no other consumer — the
// unlock flow mints its own, under different modes ("password"/"allowlist"/
// "org"), never `owner:true`.
//
// HOTFIX (production regression from the Phase 5 cutover, PR #185): if the
// view origin can't validate the edit token (e.g. a `VIEW_ACCESS_TOKEN_SECRET`
// misalignment between the app that mints and the view that verifies), the
// view's `/edit` route degrades to the public viewer, which then sees a
// PRIVATE report with no access and bounces an OWNER to `/unlock/{slug}` —
// asking an owner to unlock their own report. Defense-in-depth: an OWNER
// (never a write-grantee — see below) ALSO gets a fallback `owner:true`
// access token threaded as `oa=` alongside `et=`, so a broken edit-token
// round-trip degrades to a read-only OWNER view instead of a lockout. This
// restores (as a DEGRADE path only) the exact `owner:true` capability Phase 5
// removed as the PRIMARY path — an owner still lands in the unified editor
// whenever the edit token validates; `oa=` only matters when it doesn't.
//
// Returns the redirect Location; every failure collapses to "/" (the root
// gate sends anonymous users to sign-in) so we never reveal whether the
// report exists.
import {
  loadWritableReport,
  type ReportRepository,
  type TenancyActor,
  type WriteGrantCheckDeps,
} from "arp-application";
import { mintAccessToken, mintEditToken } from "arp-domain";
import { resolveReportSlug } from "./report-handle.server";

export const EDIT_TTL_SECONDS = 900; // 15 min edit capability (ADR-0063) — a write is
// higher-privilege than read, so it lives a fraction as long as the old 24h owner token did.

// The pre-Phase-5 owner access-token TTL — reinstated ONLY as a fallback
// (`oa=`) minted alongside the edit token, never as this route's primary
// capability. Kept at its historical 24h so the degrade path behaves exactly
// like the old owner-view flow did.
export const OWNER_TTL_SECONDS = 86_400;

export interface OwnerOpenDeps {
  readonly reports: ReportRepository;
  /** Epoch milliseconds (injectable for tests). */
  readonly now: () => number;
  /** Audit sink — the mint is logged for incident response (claude-review #122). */
  readonly log: (fields: Record<string, unknown>, msg: string) => void;
  /** Write-grant check deps (ADR-0060 §4) — needed ONLY by the edit-token
   *  branch's `loadWritableReport` re-check; the owner branch never reads it. */
  readonly writeGrant: WriteGrantCheckDeps;
}

export interface OwnerOpenRequest {
  /** The resolved read actor, or null when unauthenticated / not mirrored. */
  readonly actor: TenancyActor | null;
  /** The raw path param — a `report_…` External Id or a bare slug. */
  readonly rawHandle: string;
  /** The viewer origin for this deployment (`https://view.…`). */
  readonly viewOrigin: string;
  /** The access-token secret; undefined when private viewing isn't configured
   *  (previews/dev) — then fall through to the gated viewer. */
  readonly secret: string | undefined;
}

export async function ownerOpenLocation(
  deps: OwnerOpenDeps,
  req: OwnerOpenRequest,
): Promise<string> {
  if (!req.actor) return "/";

  const slug = await resolveReportSlug(req.rawHandle, deps.reports);
  if (!slug.ok) return "/";

  // THE CANWRITE GATE (ADR-0059 §4 keystone, extended by ADR-0060 §4 /
  // ADR-0063 Phase 5): loadWritableReport returns the report ONLY when the
  // acting user OWNS it or holds a LIVE write grant — org-scoped getReport is
  // NOT sufficient here, same reasoning the old owner-only gate relied on.
  // Runs BEFORE the no-secret fall-through so a non-canWrite user can never
  // use /open to resolve a report_… id into its capability slug (review
  // #146, preserved verbatim under the unified gate).
  const writable = await loadWritableReport(deps.reports, req.actor, slug.value, deps.writeGrant);
  if (!writable.ok) return "/"; // neither owner nor a write-grantee — no token, never reveal existence

  // Private viewing not configured (previews/dev): fall through to the bare
  // gated viewer URL — no token minted (no downstream origin trusts one, the
  // same fail-closed posture the owner-only branch used to have, now
  // extended to every canWrite user since there is only one gate).
  if (!req.secret) return `${req.viewOrigin}/${slug.value}`;

  const nowSeconds = Math.floor(deps.now() / 1000);
  const editToken = mintEditToken(
    slug.value,
    req.actor.userId,
    EDIT_TTL_SECONDS,
    req.secret,
    nowSeconds,
  );

  // OWNER vs write-grantee (`writable.value` already carries `ownerId` — one
  // lookup, no extra `loadOwnedReport` round-trip needed): ONLY the actual
  // owner also gets a fallback owner access token. Minting an `owner:true`
  // token for a mere write-grantee would be a privilege escalation (review
  // #146) — an `owner:true` token bypasses every share gate, not just this
  // report's edit capability.
  const isOwner = writable.value.ownerId === req.actor.userId;
  const ownerAccessToken = isOwner
    ? mintAccessToken(slug.value, OWNER_TTL_SECONDS, req.secret, nowSeconds, { owner: true })
    : undefined;

  // Audit the mint — same posture the old owner-token mint had: a
  // privileged, if short-lived and narrowly-scoped, write capability.
  deps.log(
    {
      orgId: req.actor.orgId,
      userId: req.actor.userId,
      slug: slug.value,
      exp: nowSeconds + EDIT_TTL_SECONDS,
      // Hotfix: note whether a fallback owner token was ALSO minted, for
      // incident response into the degrade path (never true for a grantee).
      ownerFallbackMinted: isOwner,
    },
    "owner-open: minted edit token",
  );

  const location = `${req.viewOrigin}/${slug.value}/edit?et=${encodeURIComponent(editToken)}`;
  // The `oa=` fallback param carries the SAME exposure the pre-Phase-5
  // owner-view flow already had (an owner:true token in `?access=`, handled
  // by the view origin's existing HttpOnly-cookie `?access=` flow) — this is
  // not a new surface, just a new place the identical token shape can arrive
  // from when the edit-token round-trip fails.
  return ownerAccessToken ? `${location}&oa=${encodeURIComponent(ownerAccessToken)}` : location;
}
