// The owner-open decision (GET /reports/{slug}/open) — factored out of the
// route so the SECURITY KEYSTONE is unit-testable (ADR-0059 §4 / ADR-0060
// §4, extended by ADR-0063 Phase 5): `loadWritableReport` (`isOwner OR
// hasWriteGrant`) is THE gate. EVERY canWrite user — the report's owner OR a
// write-grantee — is minted the SAME short-lived (15 min), slug-bound,
// `scope:"edit"` token (packages/domain/src/edit-token.ts) and lands in the
// SAME unified in-viewer experience (`${viewOrigin}/${slug}/edit?et=...`).
//
// Phase 5 retires the two-tier design this function used to implement: an
// owner no longer gets a separate, higher-privilege 24h `owner:true` access
// token — that capability (and its `mintAccessToken`/`resolveAccessDecision`
// machinery, still used by the SEPARATE public gated-view/unlock flow,
// unlock.$slug.tsx) is simply never minted from this route any more. Grep
// audit before this change (Phase 5 task brief) confirmed the owner-access
// token minted HERE had no other consumer — the unlock flow mints its own,
// under different modes ("password"/"allowlist"/"org"), never `owner:true`.
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
import { mintEditToken } from "arp-domain";
import { resolveReportSlug } from "./report-handle.server";

export const EDIT_TTL_SECONDS = 900; // 15 min edit capability (ADR-0063) — a write is
// higher-privilege than read, so it lives a fraction as long as the old 24h owner token did.

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
  // Audit the mint — same posture the old owner-token mint had: a
  // privileged, if short-lived and narrowly-scoped, write capability.
  deps.log(
    {
      orgId: req.actor.orgId,
      userId: req.actor.userId,
      slug: slug.value,
      exp: nowSeconds + EDIT_TTL_SECONDS,
    },
    "owner-open: minted edit token",
  );
  return `${req.viewOrigin}/${slug.value}/edit?et=${encodeURIComponent(editToken)}`;
}
