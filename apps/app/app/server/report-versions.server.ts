// Shared read guard for the version-history page and its diff view
// (ADR-0065 §3/§4). Both routes need the SAME auth as
// GET /api/v1/reports/{slug}/versions — listReportVersions's org-scoped
// `loadOrgReport` guard (../../../packages/application/src/load-owned.ts),
// deliberately narrower than getReport's `loadReadableReport` (no
// cross-org write-grantee carve-out — see list-report-versions.ts's own
// comment on that gap, tracked separately, not fixed by this ADR).
//
// Both pages also want the full `Report` aggregate (title, and — for the
// diff view — each version's manifest, to read its HTML blob), which
// listReportVersions's `VersionPage` projection deliberately omits. Calling
// `getReport` AFTER `listReportVersions` succeeds is safe: an org match
// already granted access, and getReport's gate is a strict superset of
// loadOrgReport's (an org match always satisfies it too) — so this never
// grants anything the check above didn't already establish.
import {
  getReport,
  type ListReportVersionsInput,
  listReportVersions,
  type VersionPage,
} from "arp-application";
import type { AppError, OrgId, Report, Result, Slug, UserId } from "arp-domain";
import { ok } from "arp-domain";
import { deps, identityStore, writeGrantStore } from "./container.server";

export interface OrgScopedReportRead {
  readonly report: Report;
  readonly versions: VersionPage;
}

export async function loadReportForVersionsRead(
  actor: { readonly orgId: OrgId; readonly userId: UserId },
  slug: Slug,
  versionsInput: Pick<ListReportVersionsInput, "limit" | "startingAfter" | "endingBefore"> = {},
): Promise<Result<OrgScopedReportRead, AppError>> {
  const versionsR = await listReportVersions(
    { reports: deps().reports },
    { orgId: actor.orgId },
    { slug, ...versionsInput },
  );
  if (!versionsR.ok) return versionsR;

  const reportR = await getReport(
    { reports: deps().reports, grants: writeGrantStore(), identities: identityStore() },
    { orgId: actor.orgId, userId: actor.userId },
    { slug },
  );
  if (!reportR.ok) return reportR;

  return ok({ report: reportR.value, versions: versionsR.value });
}
