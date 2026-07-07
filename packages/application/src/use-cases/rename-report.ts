// renameReport — change a Report's display title (ADR-0038). Authorization is
// the `canWrite` seam (ADR-0059/0060: owner OR write-grantee) via the shared
// loadWritableReport guard — it REPLACES the old org check for this
// operation. Pure orchestration over the ReportRepository (ADR-0024):
// load+authz → apply the domain rename transition → persist via save (which
// upserts the title). The slug is permanent and unaffected.
import {
  type AppError,
  renameReport as applyRename,
  ok,
  type Report,
  type Result,
  type Slug,
} from "arp-domain";
import { loadWritableReport, type TenancyActor, type WriteGrantCheckDeps } from "../load-owned";
import type { ReportRepository } from "../ports";

export interface RenameReportDeps extends WriteGrantCheckDeps {
  readonly reports: ReportRepository;
}
export type RenameReportActor = TenancyActor;
export interface RenameReportInput {
  readonly slug: Slug;
  readonly title: string;
}

export async function renameReport(
  deps: RenameReportDeps,
  actor: RenameReportActor,
  input: RenameReportInput,
): Promise<Result<Report, AppError>> {
  const found = await loadWritableReport(deps.reports, actor, input.slug, deps);
  if (!found.ok) return found;

  const renamed = applyRename(found.value, input.title);
  if (!renamed.ok) return renamed;

  const saved = await deps.reports.save(renamed.value);
  if (!saved.ok) return saved;
  return ok(renamed.value);
}
