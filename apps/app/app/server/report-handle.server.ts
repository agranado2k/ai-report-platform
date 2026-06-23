// Resolve a report path handle to its Slug (ADR-0052). A report is addressable by
// EITHER its `report_…` External Id OR its capability `slug`; the existing use cases
// key on Slug, so we resolve a report_ id to the report's slug here (one findById)
// and let the use case do the org-ownership authz. A report_ id for a missing /
// deleted / not-yours report resolves to NotFound (the use case would too).
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
