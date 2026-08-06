// The `/unlock/{slug}` PRIVATE-mode decision — factored out of the route so
// the access question is unit-testable next to the keystone it delegates to
// (same pattern as open-report.server.ts).
//
// THE 2026-08-06 OWNER LOCKOUT. This page used to 403 every visitor to a
// private report, with the comment "the owner reaches it via the dashboard's
// owner-open, not this page". That was false twice over:
//   1. the raw `view.<domain>/{slug}` URL an owner naturally copies and shares
//      redirects here (the viewer's ADR-0056 unlock hand-off), and
//   2. ANY failure of the edit-token round-trip on the view origin degrades to
//      the public viewer, which — for a private report — sends its OWNER here.
// So the one person entitled to the report was told "only its owner can view
// it" and had no way forward. The view origin is credential-free by design
// (ADR-002) and genuinely cannot recognise an owner; THIS origin holds the
// Clerk session and can.
//
// Two properties are load-bearing:
//
// • NO MINT HERE. The answer is a link to `/reports/{slug}/open` — the ONE
//   edit-token mint (ADR-0059 §4 / ADR-0063 Phase 5). This page only asks
//   `loadWritableReport` the same canWrite question that route asks, so there
//   is exactly one place that decides who gets a capability and exactly one
//   place that issues one.
//
// • A LINK, NOT A REDIRECT. /unlock is reached BY a redirect from the viewer,
//   and the viewer can bounce straight back (e.g. a token this origin mints
//   that the view origin can't validate — the PR #185 secret-misalignment
//   class). An automatic redirect would turn that into a tight infinite loop
//   where today it terminates in a 403. A user-activated link cannot loop.
import {
  type CanWriteDeps,
  loadWritableReport,
  type ReportRepository,
  type TenancyActor,
} from "arp-application";
import type { Slug } from "arp-domain";

export type PrivateUnlockDecision =
  /** The visitor may write this report: offer them the owner-open route. */
  | { readonly kind: "offer-owner-open"; readonly to: string }
  /** Everyone else — including anonymous visitors and unknown slugs, so the
   *  page can render ONE byte-identical 403 and never act as an existence
   *  oracle for private reports (ADR-0056). */
  | { readonly kind: "deny" };

export interface PrivateUnlockDeps {
  readonly reports: ReportRepository;
  readonly writeGrant: CanWriteDeps;
}

export interface PrivateUnlockRequest {
  /** The resolved read actor, or null when unauthenticated / not mirrored. */
  readonly actor: TenancyActor | null;
  readonly slug: Slug;
}

export async function decidePrivateUnlock(
  deps: PrivateUnlockDeps,
  req: PrivateUnlockRequest,
): Promise<PrivateUnlockDecision> {
  if (!req.actor) return { kind: "deny" };
  const writable = await loadWritableReport(deps.reports, req.actor, req.slug, deps.writeGrant);
  if (!writable.ok) return { kind: "deny" };
  return { kind: "offer-owner-open", to: `/reports/${req.slug}/open` };
}
