// The owner-open decision (GET /reports/{slug}/open) — factored out of the
// route so the SECURITY KEYSTONE is unit-testable (ADR-0059 §4): the 24h
// `owner:true` access token — the most privileged token in the system, it
// bypasses every share gate — is minted ONLY when the report's `ownerId`
// equals the acting user. Org membership is NOT enough: without this gate any
// future org member could mint an un-revocable owner token for a colleague's
// report (ADR-0056's accepted un-revocability trade-off would then apply to
// non-owners).
//
// Returns the redirect Location; every failure collapses to "/" (the root
// gate sends anonymous users to sign-in) so we never reveal whether the
// report exists.
import { loadOwnedReport, type ReportRepository, type TenancyActor } from "arp-application";
import { mintAccessToken } from "arp-domain";
import { resolveReportSlug } from "./report-handle.server";

export const OWNER_TTL_SECONDS = 86_400; // 24h owner view-session

export interface OwnerOpenDeps {
  readonly reports: ReportRepository;
  /** Epoch milliseconds (injectable for tests). */
  readonly now: () => number;
  /** Audit sink — the mint is logged for incident response (claude-review #122). */
  readonly log: (fields: Record<string, unknown>, msg: string) => void;
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

  // Private viewing not configured (previews/dev): fall through to the gated viewer.
  if (!req.secret) return `${req.viewOrigin}/${slug.value}`;

  // THE OWNERSHIP GATE (ADR-0059 §4): loadOwnedReport returns the report ONLY
  // when the acting user owns it — org-scoped getReport is NOT sufficient
  // here. Any failure → dashboard; we never reveal whether the report exists.
  const report = await loadOwnedReport(deps.reports, req.actor, slug.value);
  if (!report.ok) return "/";

  const nowSeconds = Math.floor(deps.now() / 1000);
  const token = mintAccessToken(slug.value, OWNER_TTL_SECONDS, req.secret, nowSeconds, {
    owner: true,
  });
  // Audit the mint — this token bypasses every share gate for its TTL, so log
  // who/what/when for incident response.
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
