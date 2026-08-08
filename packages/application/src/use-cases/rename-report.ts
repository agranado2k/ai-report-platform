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
import { commitWrite } from "../commit-write";
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
    // ADR-0039 derived fallback: sets the title; A -> B -> A must re-apply
    derivedFallback: "unsound",
    key: input.idempotencyKey,
    fingerprint: [input.slug, input.title],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") return reviveReportReplay(idem.value.record);
  const idemRef = idem.value.ref;

  return commitWrite(
    deps,
    {
      idemRef,
      audit: (report) => [
        {
          action: "report.renamed",
          orgId: actor.orgId,
          actorUserId: actor.userId,
          targetType: "report",
          targetId: found.value.id,
          meta: { from: fromTitle, to: report.title },
        },
      ],
      response: (report) => ({ responseStatus: 200, responseBody: reportReplayBody(report) }),
    },
    async () => {
      const saved = await deps.reports.save(renamed.value);
      return saved.ok ? ok(renamed.value) : saved;
    },
  );
}
