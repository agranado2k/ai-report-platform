// moveReport — move a Report into a different Folder (ADR-0036, Reports &
// Folders). Pure orchestration over the Report + Folder repositories
// (ADR-0024). Authorization boundary (ADR-0059 §2 / ADR-0060 §4): the actor
// must pass the `canWrite` seam for the report (owner OR write-grantee), and
// the target folder must belong to the REPORT's org — not the actor's, since
// a cross-org grantee moves a report within the org that hosts it. Load+authz
// stays OUTSIDE the tx; persists via the report's save + a `report.moved`
// audit_log row (ADR-0070), committed together (ADR-0037 §5).
import {
  type AppError,
  type FolderId,
  ok,
  placeInFolder,
  type Report,
  type Result,
  type Slug,
} from "arp-domain";
import {
  loadOwnedFolder,
  loadWritableReport,
  type OwnedGuardMessages,
  type TenancyActor,
  type WriteGrantCheckDeps,
} from "../load-owned";
import type { AuditLogger, FolderRepository, ReportRepository, UnitOfWork } from "../ports";

const TARGET_FOLDER_MESSAGES: OwnedGuardMessages = {
  notFound: "target folder not found",
  notAllowed: "target folder is not in the report's org",
};

export interface MoveReportDeps extends WriteGrantCheckDeps {
  readonly reports: ReportRepository;
  readonly folders: FolderRepository;
  /** Audit log (ADR-0070) — one `report.moved` row per move. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}

export type MoveReportActor = TenancyActor;

export interface MoveReportInput {
  readonly slug: Slug;
  readonly toFolderId: FolderId;
}

export async function moveReport(
  deps: MoveReportDeps,
  actor: MoveReportActor,
  input: MoveReportInput,
): Promise<Result<Report, AppError>> {
  const found = await loadWritableReport(deps.reports, actor, input.slug, deps);
  if (!found.ok) return found;
  const fromFolderId = found.value.folderId;

  // The target folder is checked against the REPORT's org (ADR-0059 §2) —
  // behavior-neutral today (the owner is same-org by construction), but the
  // correct rule once cross-org write grants exist.
  const target = await loadOwnedFolder(
    deps.folders,
    { orgId: found.value.orgId },
    input.toFolderId,
    TARGET_FOLDER_MESSAGES,
  );
  if (!target.ok) return target;

  const moved = placeInFolder(found.value, input.toFolderId);
  return deps.uow.run(async () => {
    const saved = await deps.reports.save(moved);
    if (!saved.ok) return saved;
    const audited = await deps.audit.record([
      {
        action: "report.moved",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "report",
        targetId: found.value.id,
        meta: { fromFolderId, toFolderId: input.toFolderId },
      },
    ]);
    if (!audited.ok) return audited;
    return ok(moved); // the moved report → the resource the API returns (ADR-0053)
  });
}
