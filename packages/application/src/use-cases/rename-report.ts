// renameReport — change a Report's display title in the acting org (ADR-0038).
// Pure orchestration over the ReportRepository (ADR-0024): load by slug → authz
// (must exist, not be taken down, belong to the actor's org) → apply the domain
// rename transition → persist via save (which upserts the title). The slug is
// permanent and unaffected.
import {
  type AppError,
  renameReport as applyRename,
  err,
  notAllowed,
  notFound,
  type OrgId,
  ok,
  type Report,
  type Result,
  type Slug,
} from "arp-domain";
import type { ReportRepository } from "../ports";

export interface RenameReportDeps {
  readonly reports: ReportRepository;
}
export interface RenameReportActor {
  readonly orgId: OrgId;
}
export interface RenameReportInput {
  readonly slug: Slug;
  readonly title: string;
}

export async function renameReport(
  deps: RenameReportDeps,
  actor: RenameReportActor,
  input: RenameReportInput,
): Promise<Result<Report, AppError>> {
  const found = await deps.reports.findBySlug(input.slug);
  if (!found.ok) return found;
  if (!found.value || found.value.deletedAt !== null) return err(notFound("report not found"));
  if (found.value.orgId !== actor.orgId) return err(notAllowed("report is not in your org"));

  const renamed = applyRename(found.value, input.title);
  if (!renamed.ok) return renamed;

  const saved = await deps.reports.save(renamed.value);
  if (!saved.ok) return saved;
  return ok(renamed.value);
}
