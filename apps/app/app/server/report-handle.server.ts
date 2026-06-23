// Resolve a report path handle to its Slug (ADR-0052). A report is addressable by
// EITHER its `report_…` External Id OR its capability `slug`; the existing use cases
// key on Slug, so we resolve a report_ id to the report's slug here (one findById)
// and let the use case do the org-ownership authz. `findById` is NOT org-scoped, so:
// a missing/deleted report_ id → NotFound (404) here; a report in ANOTHER org
// resolves to its slug, then the use case's org check returns NotAllowed (403) —
// the same 403-vs-404 posture as the slug path (ADR-0052; slugs/ids aren't enumerable).
import type { ReportRepository } from "arp-application";
import {
  type AppError,
  err,
  looksLikeReportId,
  makeReportId,
  makeSlug,
  notFound,
  ok,
  type Result,
  type Slug,
} from "arp-domain";

export async function resolveReportSlug(
  handle: string,
  reports: ReportRepository,
): Promise<Result<Slug, AppError>> {
  if (!looksLikeReportId(handle)) return makeSlug(handle); // a bare slug
  const id = makeReportId(handle);
  if (!id.ok) return id;
  const found = await reports.findById(id.value);
  if (!found.ok) return found; // infra failure → 500
  if (!found.value || found.value.deletedAt !== null) return err(notFound("report not found"));
  return ok(found.value.slug);
}
