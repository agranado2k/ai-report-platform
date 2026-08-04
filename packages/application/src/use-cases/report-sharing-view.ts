// withReportSharing — attach the composed sharing state to a Report-returning
// READ (ADR-0078 §13).
//
// WHY THE READ SURFACES NEED THIS. A report's sharing is two facts in two
// places: the `Acl` (read authorization, ADR-0056) and the Org write grant
// (ADR-0078 §1). Every WRITE surface already returns the composed answer, but
// the reads — `GET /api/v1/reports/{slug}`, `GET …/acl`, MCP `reports_get` and
// `reports_get_acl` — returned the `Acl` alone. An agent reading `acl.mode ===
// "org"` cannot tell `org_view` from `org_edit`, and will infer the wrong one:
// the two modes are IDENTICAL in the `Acl` and differ only in a row it cannot
// see. MCP is the primary write surface (ADR-0078 §10), so an agent that reads
// before it writes is exactly the caller most likely to be misled — and the
// mistake it makes is "this is already shared, nothing to do" on a report the
// whole org can edit.
//
// It is a WRAPPER, not a new use case: the authorization is whatever the read
// it wraps already decided, and this adds one indexed lookup after that gate
// has passed. Composing here rather than inside each read keeps `getReport`'s
// return type usable by the callers that only want the aggregate.
import type { AppError, Report, ReportSharingState, Result } from "arp-domain";
import { ok, reportSharingState } from "arp-domain";
import type { OrgWriteGrantStore } from "../ports";

/** A Report plus how it is shared, as a READ answers it.
 *
 *  Deliberately NOT `ReportSharingResult` (the WRITE result), whose `sharing`
 *  is non-null because a write always establishes one of the three states. A
 *  read finds reports in states the vocabulary cannot express — an advanced
 *  mode, or org write without org read — and must be able to say so. */
export interface ReportSharingView {
  readonly report: Report;
  readonly sharing: ReportSharingState | null;
}

export async function withReportSharing(
  orgWriteGrants: OrgWriteGrantStore,
  result: Result<Report, AppError>,
): Promise<Result<ReportSharingView, AppError>> {
  if (!result.ok) return result;
  const grant = await orgWriteGrants.find(result.value.id);
  // Fails CLOSED by propagating: a read that could not determine the sharing
  // state must not answer with a confident one. Degrading to "no grant" would
  // report `org_view` on a report the whole org can edit — the single wrong
  // answer this whole composition exists to prevent.
  if (!grant.ok) return grant;
  // The row's own org must match the report's, exactly as `hasOrgWriteGrant`
  // requires on the authorization path: a stale row is not org write, so it
  // must not be reported as `org_edit` either.
  const hasOrgWrite = grant.value !== null && grant.value.orgId === result.value.orgId;
  const composed: ReportSharingView = {
    report: result.value,
    // `null` when the report is in a state the three-state vocabulary cannot
    // express — an advanced mode, or org write without org read. Rounding
    // either down to `private` is the lie `reportSharingState` returns null to
    // prevent, and on a READ surface it would be the lie an agent acts on.
    sharing: reportSharingState(result.value.acl.mode, hasOrgWrite),
  };
  return ok(composed);
}
