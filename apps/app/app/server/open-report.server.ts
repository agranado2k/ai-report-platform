// The owner-open decision (GET /reports/{slug}/open) — factored out of the
// route so the SECURITY KEYSTONE is unit-testable (ADR-0059 §4 / ADR-0060
// §4, extended by ADR-0063 Phase 5): `loadWritableReport` (`isOwner OR
// hasWriteGrant`) is THE gate. EVERY canWrite user — the report's owner OR a
// write-grantee — is minted the SAME short-lived (15 min), slug-bound,
// `scope:"edit"` token (packages/domain/src/edit-token.ts).
//
// WHERE that capability is spent is the `destination` (#363): the OWNER VIEW
// (`${viewOrigin}/${slug}/view?et=...`, ADR-0089) by DEFAULT, and the editor
// (`/edit`) only when a caller asks for it by name. Until that flip every
// canWrite user landed in the editor, because it was the only authenticated
// viewer surface — which is exactly why an owner clicked Edit when they wanted
// to LOOK at their own report and got the `Report HTML schema`'s reduction of
// it (no `<script>`, flattened `<svg>`) rather than the report they published.
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
  type CanWriteDeps,
  loadWritableReport,
  type ReportRepository,
  type TenancyActor,
} from "arp-application";
import { mintAccessToken, mintEditToken, mintGranteeReadToken } from "arp-domain";
import { resolveReportSlug } from "./report-handle.server";

export const EDIT_TTL_SECONDS = 900; // 15 min edit capability (ADR-0063) — a write is
// higher-privilege than read, so it lives a fraction as long as the old 24h owner token did.

// The pre-Phase-5 owner access-token TTL — reinstated ONLY as a fallback
// (`oa=`) minted alongside the edit token, never as this route's primary
// capability. Kept at its historical 24h so the degrade path behaves exactly
// like the old owner-view flow did.
export const OWNER_TTL_SECONDS = 86_400;

// The `Grantee read token`'s TTL (ADR-0091 §4) — the READ capability a canWrite
// NON-owner carries so the owner view's sandboxed frame renders the report
// instead of the unlock wall.
//
// Deliberately the EDIT token's TTL and deliberately NOT `OWNER_TTL_SECONDS`.
// ADR-0056 accepted "un-revocable for its TTL" for the owner token, and that
// trade was accepted ABOUT OWNERS: ownership cannot be revoked. A write grant
// can be, and routinely is. Tying the grantee's read capability to their edit
// capability means the whole session — `arp_view`, `arp_view_gr`, and the
// `arp_unlock` derived from it — lapses TOGETHER, and the recovery is a funnel
// back through this very function, which re-runs `loadWritableReport` LIVE. So
// revocation latency for a grantee is bounded at this TTL without the
// credential-free view origin ever having to know what a write grant is
// (ADR-0091 §5 records the rejected live-check alternative and names this
// constant as the first lever if that bound ever needs to be tighter).
export const GRANTEE_READ_TTL_SECONDS = EDIT_TTL_SECONDS;

export interface OwnerOpenDeps {
  readonly reports: ReportRepository;
  /** Epoch milliseconds (injectable for tests). */
  readonly now: () => number;
  /** Audit sink — the mint is logged for incident response (claude-review #122). */
  readonly log: (fields: Record<string, unknown>, msg: string) => void;
  /** Write-grant check deps (ADR-0060 §4) — needed ONLY by the edit-token
   *  branch's `loadWritableReport` re-check; the owner branch never reads it. */
  readonly writeGrant: CanWriteDeps;
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
  /**
   * Which authenticated surface to spend the minted capability on (#363).
   * Defaults to the OWNER VIEW.
   *
   * The flip: until #363 every canWrite user landed in the editor, because the
   * editor was the only authenticated surface there was. ADR-0089 added the
   * owner view — first-party chrome above the BYTE-FOR-BYTE report — and with
   * it the thing an owner actually wanted when they clicked their own report:
   * to LOOK at it. The editor shows them the `Report HTML schema`'s reduction
   * of their document instead (no `<script>`, flattened `<svg>`), which is the
   * regression ADR-0089's Context opens with.
   *
   * `"editor"` is not a legacy alias — it is load-bearing, and the loop it
   * closes is easy to miss. The owner view's Edit action is a PLAIN LINK to
   * `/<slug>/edit`, which holds no capability under that Path and therefore
   * funnels back through this mint (ADR-0089 §4b: that hop is not a cost, it is
   * the live `canWrite` re-check, bought back). If the funnel could not name
   * the editor, this function would send the user to the owner view they just
   * clicked Edit on, and the editor would be unreachable. So the gate's
   * `/edit` funnel carries `?to=edit`, and so does the dashboard row's Edit
   * action.
   *
   * It does NOT widen who may open what: the `loadWritableReport` gate above
   * runs first and identically for both, and both fall through to the same
   * bare gated viewer when no secret is configured.
   */
  readonly destination?: OwnerOpenDestination;
}

/** Where `/reports/{slug}/open` spends the capability it mints (#363). */
export type OwnerOpenDestination =
  /** `${viewOrigin}/${slug}/view` — ADR-0089's owner view. The default. */
  | "ownerView"
  /** `${viewOrigin}/${slug}/edit` — the `Unified experience` editor. */
  | "editor";

/** The URL segment each destination lives on. A lookup rather than a ternary at
 *  the call site so adding a fourth authenticated surface is a one-line change
 *  here and a type error everywhere it is not handled. */
const DESTINATION_SEGMENT: Record<OwnerOpenDestination, string> = {
  ownerView: "view",
  editor: "edit",
};

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
    nowSeconds, // a fresh session — this route is the only FIRST mint
    // The org the actor is VERIFIED to be acting in (ADR-0078 §1). The
    // acceptance seam compares it against the report's org for the org-write
    // leg; without it that comparison reads the org off the report and can
    // never fail.
    req.actor.orgId,
  );

  // OWNER vs write-grantee (`writable.value` already carries `ownerId` — one
  // lookup, no extra `loadOwnedReport` round-trip needed). ONE boolean, TWO
  // mutually exclusive read capabilities — and that structure, not a check
  // further downstream, is the no-escalation guarantee (ADR-0091 §2):
  //
  //   • OWNER → a fallback `owner:true` Access token (`oa=`). Minting one for a
  //     mere write-grantee would be a privilege escalation (review #146): an
  //     `owner:true` token bypasses EVERY share gate, not just this report's
  //     edit capability, and it asserts something false about the principal.
  //
  //   • canWrite NON-OWNER → a `Grantee read token` (`gr=`, ADR-0091). Until
  //     that record they got nothing, which meant ADR-0089's owner view wrapped
  //     first-party chrome around the UNLOCK WALL for them: the framed
  //     `GET /<slug>` is gated on its own merits and they had no cookie for it.
  //     The token is a read capability with no `owner` field and no `mode`
  //     field in its shape at all, so the escalating claim is unrepresentable
  //     rather than merely unset.
  //
  // Both are minted HERE, in this one ternary, because `/open` is the app's ONE
  // mint (ADR-0059 §4) and it has already run the canWrite gate above. A second
  // mint seam would be a second place for this owner/non-owner split to be
  // re-decided, which is exactly the mistake ADR-0091 exists to foreclose.
  const destination = req.destination ?? "ownerView";
  const isOwner = writable.value.ownerId === req.actor.userId;
  const ownerAccessToken = isOwner
    ? mintAccessToken(slug.value, OWNER_TTL_SECONDS, req.secret, nowSeconds, { owner: true })
    : undefined;
  // The `isOwner` split is still the ONE ternary ADR-0091 §2 makes the
  // no-escalation guarantee — the extra condition can only ever WITHHOLD the
  // grantee's token, never hand an owner a `gr` nor a non-owner an `oa`, so the
  // mutual exclusivity is untouched.
  //
  // Why withhold it on the editor: ADR-0091 §3 scopes `arp_view_gr` to
  // `Path=/<slug>/view` so a grantee's read capability is never sent on
  // `/edit`, and `EDIT_SURFACE` accordingly has no grantee cookie — so a `gr`
  // arriving at the editor is consumed by nothing. Minting one anyway would put
  // a live 15-minute signed capability into the address bar, the history and
  // the referer of a surface that cannot use it: pure exposure, no capability,
  // against ADR-0089 §4's "no token is ever served on" posture. `oa=` is not
  // withheld, because `/edit` genuinely does consume it (ADR-0063 Phase 5-G).
  const granteeReadToken =
    isOwner || destination !== "ownerView"
      ? undefined
      : mintGranteeReadToken(
          slug.value,
          req.actor.userId,
          GRANTEE_READ_TTL_SECONDS,
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
      // Hotfix: note whether a fallback owner token was ALSO minted, for
      // incident response into the degrade path (never true for a grantee).
      ownerFallbackMinted: isOwner,
      // ADR-0091: the grantee's counterpart. Carried as its OWN field rather
      // than inferred from `!ownerFallbackMinted`, so the two mints are
      // distinguishable in a log query instead of one being the absence of the
      // other — and so a future third case cannot silently read as this one.
      granteeReadMinted: granteeReadToken !== undefined,
    },
    "owner-open: minted edit token",
  );

  const segment = DESTINATION_SEGMENT[destination];
  const location = `${req.viewOrigin}/${slug.value}/${segment}?et=${encodeURIComponent(editToken)}`;
  // Exactly one of these is ever appended (see the ternary above).
  //
  // `oa=` carries the SAME exposure the pre-Phase-5 owner-view flow already had
  // (an owner:true token in `?access=`, handled by the view origin's existing
  // HttpOnly-cookie `?access=` flow) — not a new surface, just a new place the
  // identical token shape can arrive from when the edit-token round-trip fails.
  //
  // `gr=` is the grantee's read capability (ADR-0091 §3). The view origin
  // VERIFIES it — never mints, ADR-0056's keystone — and redeems it into the
  // same `arp_unlock` cookie at `Path=/<slug>` that the framed navigation
  // carries, plus a cookie copy at `Path=/<slug>/view` so it survives the
  // clean-URL 303's query strip.
  // It exists only for the owner-view destination (see the mint above), so no
  // destination check is needed here.
  if (ownerAccessToken) return `${location}&oa=${encodeURIComponent(ownerAccessToken)}`;
  if (granteeReadToken) return `${location}&gr=${encodeURIComponent(granteeReadToken)}`;
  return location;
}
