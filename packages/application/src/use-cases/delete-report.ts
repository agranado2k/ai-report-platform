// deleteReport — soft-delete a Report. OWNER-ONLY, permanently (ADR-0059 §2 —
// deliberately NOT on the canWrite seam: a future write grant must never allow
// delete). Pure orchestration over the ReportRepository (ADR-0024): load+authz
// (the shared loadOwnedReport owner guard) → softDelete (sets deleted_at; the
// viewer then returns 410) + an audit_log row (ADR-0070), committed together
// (ADR-0037 §5 commit-last atomicity). The slug + blobs are retained for the
// appeal/purge window (db-design.md).
import { type AppError, ok, type Result, type Slug } from "arp-domain";
import { beginIdempotentWrite, type IdempotentWriteDeps } from "../idempotent-write";
import { loadOwnedReport, type TenancyActor } from "../load-owned";
import type { AuditLogger, ReportRepository, UnitOfWork } from "../ports";

const ROUTE = "DELETE /api/v1/reports/{slug}";

export interface DeleteReportDeps extends IdempotentWriteDeps {
  readonly reports: ReportRepository;
  /** Audit log (ADR-0070) — one `report.deleted` row per soft-delete. */
  readonly audit: AuditLogger;
  readonly uow: UnitOfWork;
}
export type DeleteReportActor = TenancyActor;
export interface DeleteReportInput {
  readonly slug: Slug;
  /** The client's explicit `Idempotency-Key` header (ADR-0039), when sent. */
  readonly idempotencyKey?: string;
}

export async function deleteReport(
  deps: DeleteReportDeps,
  actor: DeleteReportActor,
  input: DeleteReportInput,
): Promise<Result<void, AppError>> {
  // Idempotency (ADR-0039), claimed BEFORE the load (unlike the non-delete
  // mutations): a successful delete makes the retry's own load 404 (the report
  // is now soft-deleted), so the replay check must run first for the retried
  // request to see its recorded 204 instead of NotFound. Replay is keyed per
  // acting user — it only ever returns a response that same user already got.
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    // ADR-0039 derived fallback: delete-shaped; the key must not be burnable before the fact
    derivedFallback: "unsound",
    key: input.idempotencyKey,
    fingerprint: [input.slug],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") return ok(undefined);
  const idemRef = idem.value.ref;

  const found = await loadOwnedReport(deps.reports, actor, input.slug);
  if (!found.ok) return found;

  return deps.uow.run(async () => {
    const deleted = await deps.reports.softDelete(found.value.id);
    if (!deleted.ok) return deleted;
    const audited = await deps.audit.record([
      {
        action: "report.deleted",
        orgId: actor.orgId,
        actorUserId: actor.userId,
        targetType: "report",
        targetId: found.value.id,
      },
    ]);
    if (!audited.ok) return audited;
    // No ref when the client sent no Idempotency-Key: an `unsound` operation
    // claims nothing, so there is nothing to complete (issue #233).
    return idemRef
      ? deps.idempotency.complete(idemRef, { responseStatus: 204, responseBody: null })
      : ok(undefined);
  });
}
