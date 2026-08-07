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
import { commitWrite } from "../commit-write";
import {
  beginIdempotentWrite,
  type IdempotentWriteDeps,
  reportReplayBody,
  reviveReportReplay,
} from "../idempotent-write";
import {
  type CanWriteDeps,
  type FolderAccessDeps,
  type FolderGuardMessages,
  loadVisibleFolder,
  loadWritableReport,
  type TenancyActor,
} from "../load-owned";
import type { AuditLogger, FolderRepository, ReportRepository, UnitOfWork } from "../ports";

const ROUTE = "POST /api/v1/reports/{slug}/move";

const TARGET_FOLDER_MESSAGES: FolderGuardMessages = {
  notFound: "target folder not found",
  notInOrg: "target folder is not in the report's org",
  notWritable: "you do not have write access to the target folder", // unused (visibility-gated)
};

export interface MoveReportDeps extends CanWriteDeps, FolderAccessDeps, IdempotentWriteDeps {
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
  /** The client's explicit `Idempotency-Key` header (ADR-0039), when sent. */
  readonly idempotencyKey?: string;
}

export async function moveReport(
  deps: MoveReportDeps,
  actor: MoveReportActor,
  input: MoveReportInput,
): Promise<Result<Report, AppError>> {
  const found = await loadWritableReport(deps.reports, actor, input.slug, deps);
  if (!found.ok) return found;
  const fromFolderId = found.value.folderId;

  // The target folder is checked against the REPORT's org (ADR-0059 §2 — a
  // cross-org grantee moves a report within the org that hosts it) AND must be
  // VISIBLE to the acting user (ADR-0076): someone else's private folder is
  // not a valid target (it reads as NotFound — existence is private). The
  // org-visibility leg is org-context-relative, so a cross-org grantee can
  // still target the report org's org-visible folders (today's behavior).
  const target = await loadVisibleFolder(
    deps.folders,
    { orgId: found.value.orgId, userId: actor.userId },
    input.toFolderId,
    deps,
    TARGET_FOLDER_MESSAGES,
  );
  if (!target.ok) return target;

  // Idempotency (ADR-0039): explicit key, else derived from user+route+payload.
  const idem = await beginIdempotentWrite(deps, {
    actingUserId: actor.userId,
    route: ROUTE,
    // ADR-0039 derived fallback: sets the parent folder; A -> B -> A must re-apply
    derivedFallback: "unsound",
    key: input.idempotencyKey,
    fingerprint: [input.slug, input.toFolderId],
  });
  if (!idem.ok) return idem;
  if (idem.value.outcome === "replay") return reviveReportReplay(idem.value.record);
  const idemRef = idem.value.ref;

  const moved = placeInFolder(found.value, input.toFolderId);
  return commitWrite(
    deps,
    {
      idemRef,
      audit: () => [
        {
          action: "report.moved",
          orgId: actor.orgId,
          actorUserId: actor.userId,
          targetType: "report",
          targetId: found.value.id,
          meta: { fromFolderId, toFolderId: input.toFolderId },
        },
      ],
      response: (report) => ({ responseStatus: 200, responseBody: reportReplayBody(report) }),
    },
    // the moved report → the resource the API returns (ADR-0053)
    async () => {
      const saved = await deps.reports.save(moved);
      return saved.ok ? ok(moved) : saved;
    },
  );
}
