// The owner-open decision (GET /reports/{slug}/open) — factored out of the
// route so the SECURITY KEYSTONE is unit-testable (ADR-0059 §4): the 24h
// `owner:true` access token — the most privileged token in the system, it
// bypasses every share gate — is minted ONLY when the report's `ownerId`
// equals the acting user. Org membership is NOT enough: without this gate any
// future org member could mint an un-revocable owner token for a colleague's
// report (ADR-0056's accepted un-revocability trade-off would then apply to
// non-owners).
//
// ADR-0063 extends this decision: a NON-owner who still `canWrite` (a
// write-grantee, ADR-0060 §4) is minted a short-lived (15 min), slug-bound,
// `scope:"edit"` token instead — the app↔view/editor in-viewer-editing
// capability, a structurally distinct, lower-TTL primitive from the owner's
// access token (packages/domain/src/edit-token.ts). The ownership gate is
// checked FIRST and short-circuits: an owner is trivially canWrite too, but
// MUST still get the owner access token, never the edit token — the two
// capabilities are not layered.
//
// Returns the redirect Location; every failure collapses to "/" (the root
// gate sends anonymous users to sign-in) so we never reveal whether the
// report exists.
import {
  loadOwnedReport,
  loadWritableReport,
  type ReportRepository,
  type TenancyActor,
  type WriteGrantCheckDeps,
} from "arp-application";
import { mintAccessToken, mintEditToken } from "arp-domain";
import { resolveReportSlug } from "./report-handle.server";

export const OWNER_TTL_SECONDS = 86_400; // 24h owner view-session
export const EDIT_TTL_SECONDS = 900; // 15 min edit capability (ADR-0063) — a write is
// higher-privilege than read, so it lives a fraction as long as the owner token.

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

  // THE OWNERSHIP GATE (ADR-0059 §4): loadOwnedReport returns the report ONLY
  // when the acting user owns it — org-scoped getReport is NOT sufficient
  // here. Runs BEFORE the no-secret fall-through so a non-owner can never use
  // /open to resolve a report_… id into its capability slug (review #146).
  // Checked FIRST, ahead of the canWrite/edit-token branch below: an owner is
  // trivially canWrite too, but must always get the higher-privilege owner
  // access token, never the edit token (ADR-0063).
  const owned = await loadOwnedReport(deps.reports, req.actor, slug.value);
  if (owned.ok) {
    // Private viewing not configured (previews/dev): fall through to the
    // gated viewer — owner-only, per the gate above.
    if (!req.secret) return `${req.viewOrigin}/${slug.value}`;

    const nowSeconds = Math.floor(deps.now() / 1000);
    const token = mintAccessToken(slug.value, OWNER_TTL_SECONDS, req.secret, nowSeconds, {
      owner: true,
    });
    // Audit the mint — this token bypasses every share gate for its TTL, so
    // log who/what/when for incident response.
    deps.log(
      {
        orgId: req.actor.orgId,
        userId: req.actor.userId,
        slug: slug.value,
        exp: nowSeconds + OWNER_TTL_SECONDS,
      },
      "owner-open: minted owner access token",
    );
    return `${req.viewOrigin}/${slug.value}?access=${encodeURIComponent(token)}`;
  }

  // NOT the owner: the canWrite / edit-token branch (ADR-0063 §3). Only
  // attempted when a secret is configured — no secret means no downstream
  // origin trusts a signed token at all (previews/dev), so a non-owner falls
  // through to "/" exactly like today, never reaching loadWritableReport.
  if (!req.secret) return "/";

  const writable = await loadWritableReport(deps.reports, req.actor, slug.value, deps.writeGrant);
  if (!writable.ok) return "/"; // neither owner nor a write-grantee — no token, never reveal existence

  const nowSeconds = Math.floor(deps.now() / 1000);
  const editToken = mintEditToken(
    slug.value,
    req.actor.userId,
    EDIT_TTL_SECONDS,
    req.secret,
    nowSeconds,
  );
  // Audit the mint — same posture as the owner-token mint above: this is a
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
