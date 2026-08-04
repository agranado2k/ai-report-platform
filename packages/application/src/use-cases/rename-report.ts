// renameReport — change a Report's display title (ADR-0038). Authorization is
// the `canWrite` seam (ADR-0059/0060: owner OR write-grantee) via the shared
// loadWritableReport guard — it REPLACES the old org check for this
// operation. Pure orchestration over the ReportRepository (ADR-0024):
// load+authz (OUTSIDE the tx) → apply the domain rename transition → persist
// via save + a `report.renamed` audit_log row (ADR-0070), committed together
// (ADR-0037 §5 commit-last atomicity). The slug is permanent and unaffected.
import {
  type AppError,
  renameReport as applyRename,
  ok,
  type Report,
  type Result,
  type Slug,
} from "arp-domain";
import {
  beginIdempotentWrite,
  type IdempotentWriteDeps,
  reportReplayBody,
  reviveReportReplay,
} from "../idempotent-write";
import { type CanWriteDeps, loadWritableReport, type TenancyActor } from "../load-owned";
import type { AuditLogger, ReportRepository, UnitOfWork } from "../ports";

const ROUTE = "PATCH /api/v1/reports/{slug}";

export interface RenameReportDeps extends CanWriteDeps, IdempotentWriteDeps {
  readonly reports: ReportRepository;
  /** Audit log (ADR-0070) — one `report.renamed` row per rename. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}
export type RenameReportActor = TenancyActor;
export interface RenameReportInput {
  readonly slug: Slug;
  readonly title: string;
  /** The client's explicit `Idempotency-Key` header (ADR-0039), when sent. */
  readonly idempotencyKey?: string;
}

export async function renameReport(
  deps: RenameReportDeps,
  actor: RenameReportActor,
  input: RenameReportInput,
): Promise<Result<Report, AppError>> {
  const found = await loadWritableReport(deps.reports, actor, input.slug, deps);
  if (!found.ok) return found;
  const fromTitle = found.value.title;

  const renamed = applyRename(found.value, input.title);
  if (!renamed.ok) return renamed;

  // Idempotency (ADR-0039): explicit key, else derived from user+route+payload.
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    key: input.idempotencyKey,
    fingerprint: [input.slug, input.title],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") return reviveReportReplay(idem.value.record);
  const idemRef = idem.value.ref;

  return deps.uow.run(async () => {
    const saved = await deps.reports.save(renamed.value);
    if (!saved.ok) return saved;
    const audited = await deps.audit.record([
      {
        action: "report.renamed",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "report",
        targetId: found.value.id,
        meta: { from: fromTitle, to: renamed.value.title },
      },
    ]);
    if (!audited.ok) return audited;
    const done = await deps.idempotency.complete(idemRef, {
      responseStatus: 200,
      responseBody: reportReplayBody(renamed.value),
    });
    if (!done.ok) return done;
    return ok(renamed.value);
  });
}
