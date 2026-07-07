// The tenancy / ownership guards shared by every single-resource use case
// (ADR-0038 for reports, ADR-0036 for folders, ADR-0059 for ownership):
//
// - `loadOrgReport` — READS. Load by slug → a soft-deleted row reads as absent
//   → the row must belong to the actor's org (metadata stays org-visible,
//   ADR-0059 §3).
// - `loadOwnedReport` — owner-gated WRITES (delete, setAcl, grant management).
//   Org-agnostic: the row must be OWNED by the acting user (ADR-0059 §2).
// - `canWrite` + `loadWritableReport` — the write seam for rename / re-upload /
//   move. This PR: canWrite = isOwner; ADR-0060 extends it to
//   isOwner OR hasWriteGrant (which is why it is a distinct seam and not
//   folded into loadOwnedReport — delete/setAcl stay owner-only permanently).
// - `loadOwnedFolder` — folders stay org-scoped (ADR-0059 §5).
//
// Denials are NotAllowed (→ 403, same status as the old cross-org denial —
// never 404; only missing/soft-deleted rows read as NotFound). Repo errors
// pass through unchanged. Callers may override the NotFound/NotAllowed message
// text for one call site — e.g. moveReport's target-folder check reads
// "target folder …" — the existence/soft-delete behavior is identical
// everywhere.
import {
  type AppError,
  err,
  type Folder,
  type FolderId,
  notAllowed,
  notFound,
  type OrgId,
  ok,
  type Report,
  type Result,
  type Slug,
  type UserId,
} from "arp-domain";
import type { FolderRepository, ReportRepository } from "./ports";

/** The acting principal every report use case authorizes against (ADR-0059):
 *  the org scopes tenancy (reads, quota, listing); the user decides ownership. */
export interface TenancyActor {
  readonly orgId: OrgId;
  readonly userId: UserId;
}

/** Override the default NotFound / NotAllowed message text for one call site. */
export interface OwnedGuardMessages {
  readonly notFound: string;
  readonly notAllowed: string;
}

const REPORT_ORG_MESSAGES: OwnedGuardMessages = {
  notFound: "report not found",
  notAllowed: "report is not in your org",
};

const REPORT_OWNER_MESSAGES: OwnedGuardMessages = {
  notFound: "report not found",
  notAllowed: "you do not own this report",
};

const REPORT_WRITE_MESSAGES: OwnedGuardMessages = {
  notFound: "report not found",
  notAllowed: "you do not have write access to this report",
};

const FOLDER_MESSAGES: OwnedGuardMessages = {
  notFound: "folder not found",
  notAllowed: "folder is not in your org",
};

/** Shared existence guard: load by slug; a missing or soft-deleted row is
 *  NotFound. Authorization is the caller's second step. */
async function loadLiveReport(
  reports: ReportRepository,
  slug: Slug,
  messages: OwnedGuardMessages,
): Promise<Result<Report, AppError>> {
  const found = await reports.findBySlug(slug);
  if (!found.ok) return found;
  if (!found.value || found.value.deletedAt !== null) return err(notFound(messages.notFound));
  return ok(found.value);
}

/** Load a Report by slug for a READ: must exist, not be soft-deleted, and
 *  belong to the actor's org (ADR-0038, ADR-0059 §3). */
export async function loadOrgReport(
  reports: ReportRepository,
  actor: Pick<TenancyActor, "orgId">,
  slug: Slug,
  messages: OwnedGuardMessages = REPORT_ORG_MESSAGES,
): Promise<Result<Report, AppError>> {
  const found = await loadLiveReport(reports, slug, messages);
  if (!found.ok) return found;
  if (found.value.orgId !== actor.orgId) return err(notAllowed(messages.notAllowed));
  return ok(found.value);
}

/** Load a Report by slug for an OWNER-ONLY write (delete, setAcl, grant
 *  management — ADR-0059 §2): must exist, not be soft-deleted, and be owned by
 *  the acting user. Org-agnostic — ownership, not tenancy, decides. */
export async function loadOwnedReport(
  reports: ReportRepository,
  actor: TenancyActor,
  slug: Slug,
  messages: OwnedGuardMessages = REPORT_OWNER_MESSAGES,
): Promise<Result<Report, AppError>> {
  const found = await loadLiveReport(reports, slug, messages);
  if (!found.ok) return found;
  if (found.value.ownerId !== actor.userId) return err(notAllowed(messages.notAllowed));
  return ok(found.value);
}

/** May `actor` modify this report (rename / re-upload / move)? The seam
 *  ADR-0060 extends to `isOwner OR hasWriteGrant`; this PR: ownership only.
 *  Deliberately org-agnostic — a write grant works cross-org (ADR-0060 §4). */
export function canWrite(report: Report, actor: Pick<TenancyActor, "userId">): boolean {
  return report.ownerId === actor.userId;
}

/** Load a Report by slug for a `canWrite`-gated write (rename / re-upload /
 *  move — ADR-0059 §2): must exist, not be soft-deleted, and pass `canWrite`.
 *  Replaces the old org check for these operations. */
export async function loadWritableReport(
  reports: ReportRepository,
  actor: TenancyActor,
  slug: Slug,
  messages: OwnedGuardMessages = REPORT_WRITE_MESSAGES,
): Promise<Result<Report, AppError>> {
  const found = await loadLiveReport(reports, slug, messages);
  if (!found.ok) return found;
  if (!canWrite(found.value, actor)) return err(notAllowed(messages.notAllowed));
  return ok(found.value);
}

/** Load a Folder by id: must exist, not be soft-deleted, and belong to the
 *  actor's org — else NotFound / NotAllowed (ADR-0036; folders stay org-scoped
 *  under ADR-0059 §5). */
export async function loadOwnedFolder(
  folders: FolderRepository,
  actor: Pick<TenancyActor, "orgId">,
  folderId: FolderId,
  messages: OwnedGuardMessages = FOLDER_MESSAGES,
): Promise<Result<Folder, AppError>> {
  const found = await folders.findById(folderId);
  if (!found.ok) return found;
  if (!found.value || found.value.deletedAt !== null) return err(notFound(messages.notFound));
  if (found.value.orgId !== actor.orgId) return err(notAllowed(messages.notAllowed));
  return ok(found.value);
}
