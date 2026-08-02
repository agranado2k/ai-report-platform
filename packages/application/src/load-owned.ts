// The tenancy / ownership guards shared by every single-resource use case
// (ADR-0038 for reports, ADR-0036 for folders, ADR-0059 for ownership,
// ADR-0060 for write grants):
//
// - `loadOrgReport` — plain org-scoped READS (no grantee carve-out — nothing
//   currently calls this; kept for any future strictly-org-scoped read).
// - `loadReadableReport` — the actual GET seam: org-visible, PLUS a cross-org
//   write-grantee metadata carve-out (ADR-0059 §3 / ADR-0060 §4) — a grantee
//   can read the metadata of a report they can write, even outside its org.
// - `loadOwnedReport` — owner-gated WRITES (delete, setAcl, grant management).
//   Org-agnostic: the row must be OWNED by the acting user (ADR-0059 §2).
// - `hasWriteGrant` + `canWrite` + `loadWritableReport` — the write seam for
//   rename / re-upload / move: `isOwner OR hasWriteGrant` (ADR-0060 §4). A
//   grant is matched by `granteeUserId === actor.userId` OR normalized-email
//   equality with the actor's mirrored email (resolved via IdentityStore —
//   the grantee may not have had a `grantee_user_id` at grant time). This is
//   a distinct seam from `loadOwnedReport` — delete/setAcl stay owner-only
//   permanently.
// - `loadVisibleFolder` + `loadWritableFolder` — the ADR-0076 folder seams
//   (replacing the old org-only `loadOwnedFolder`; ADR-0059 §5 is reversed):
//   a folder is VISIBLE to its owner, to everyone when legacy (ownerId null)
//   or org-visible, and to folder-share grantees (userId-or-email match,
//   ADR-0060 §2 pattern); it is WRITABLE (rename / delete / create children)
//   by its owner or by anyone for legacy/org-visible folders — shares grant
//   visibility ONLY. A same-org folder the actor cannot SEE reads as NotFound
//   (existence is private, ADR-0075 spirit); a visible-but-not-writable one
//   reads as NotAllowed; a cross-org folder keeps the old NotAllowed contract.
//
// Denials are NotAllowed (→ 403, same status as the old cross-org denial —
// never 404; only missing/soft-deleted rows read as NotFound). Repo errors
// pass through unchanged. Callers may override the NotFound/NotAllowed message
// text for one call site — e.g. moveReport's target-folder check reads
// "target folder …" — the existence/soft-delete behavior is identical
// everywhere.
import {
  type AppError,
  canWriteFolder,
  err,
  type Folder,
  type FolderId,
  isFolderBroadlyVisibleTo,
  notAllowed,
  notFound,
  type OrgId,
  ok,
  type Report,
  type ReportId,
  type Result,
  type Slug,
  type UserId,
} from "arp-domain";
import type {
  FolderRepository,
  FolderShareStore,
  IdentityStore,
  ReportRepository,
  WriteGrantStore,
} from "./ports";

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

/** Deps the write-grant check needs (ADR-0060 §2): the grant store itself,
 *  plus a way to resolve the acting user's mirrored email (for the
 *  email-match fallback when a grant's `granteeUserId` is still null). */
export interface WriteGrantCheckDeps {
  readonly grants: WriteGrantStore;
  readonly identities: Pick<IdentityStore, "findEmailByUserId">;
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
 *  belong to the actor's org (ADR-0038, ADR-0059 §3). No grantee carve-out —
 *  see `loadReadableReport` for the seam `getReport` actually uses. */
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

/** Does `actor` hold a write grant on `reportId` (ADR-0060 §2)? Resolves the
 *  actor's mirrored email (a grant's `granteeUserId` may still be null if the
 *  grantee hadn't signed up at grant time) and asks the WriteGrantStore for a
 *  match by userId OR normalized email. */
export async function hasWriteGrant(
  reportId: ReportId,
  actor: Pick<TenancyActor, "userId">,
  deps: WriteGrantCheckDeps,
): Promise<Result<boolean, AppError>> {
  const email = await deps.identities.findEmailByUserId(actor.userId);
  if (!email.ok) return email;
  const found = await deps.grants.findFor(reportId, {
    userId: actor.userId,
    email: email.value ?? undefined,
  });
  if (!found.ok) return found;
  return ok(found.value !== null);
}

/** May `actor` modify this report (rename / re-upload / move)? `isOwner OR
 *  hasWriteGrant` (ADR-0060 §4) — deliberately org-agnostic; a write grant
 *  works cross-org. */
export async function canWrite(
  report: Report,
  actor: Pick<TenancyActor, "userId">,
  deps: WriteGrantCheckDeps,
): Promise<Result<boolean, AppError>> {
  if (report.ownerId === actor.userId) return ok(true);
  return hasWriteGrant(report.id, actor, deps);
}

/** Load a Report by slug for a `canWrite`-gated write (rename / re-upload /
 *  move — ADR-0059 §2 / ADR-0060 §4): must exist, not be soft-deleted, and
 *  pass `canWrite`. Replaces the old org check for these operations. */
export async function loadWritableReport(
  reports: ReportRepository,
  actor: TenancyActor,
  slug: Slug,
  deps: WriteGrantCheckDeps,
  messages: OwnedGuardMessages = REPORT_WRITE_MESSAGES,
): Promise<Result<Report, AppError>> {
  const found = await loadLiveReport(reports, slug, messages);
  if (!found.ok) return found;
  const allowed = await canWrite(found.value, actor, deps);
  if (!allowed.ok) return allowed;
  if (!allowed.value) return err(notAllowed(messages.notAllowed));
  return ok(found.value);
}

/** Load a Report by slug for the GET seam (ADR-0059 §3 / ADR-0060 §4): must
 *  exist, not be soft-deleted, and the actor is its OWNER, OR in its org, OR
 *  holds a write grant on it — the carve-outs that let the owner read from any
 *  acting-org context and a cross-org grantee confirm what they can write
 *  before renaming/re-uploading/moving it. */
export async function loadReadableReport(
  reports: ReportRepository,
  actor: TenancyActor,
  slug: Slug,
  deps: WriteGrantCheckDeps,
  messages: OwnedGuardMessages = REPORT_ORG_MESSAGES,
): Promise<Result<Report, AppError>> {
  const found = await loadLiveReport(reports, slug, messages);
  if (!found.ok) return found;
  // Owner-first, org-agnostic — symmetric with canWrite (an owner acting under
  // a different active org must not be able to rename what they can't GET;
  // review #150, epic #142 "owner always reads+writes").
  if (found.value.ownerId === actor.userId) return ok(found.value);
  if (found.value.orgId === actor.orgId) return ok(found.value);
  const grantee = await hasWriteGrant(found.value.id, actor, deps);
  if (!grantee.ok) return grantee;
  if (!grantee.value) return err(notAllowed(messages.notAllowed));
  return ok(found.value);
}

/** Deps the folder visibility/write checks need (ADR-0076): the share store
 *  plus the actor's mirrored email (for the email-match fallback when a
 *  share's `granteeUserId` is still null) — the exact `WriteGrantCheckDeps`
 *  shape, keyed to folder shares. */
export interface FolderAccessDeps {
  readonly folderShares: FolderShareStore;
  readonly identities: Pick<IdentityStore, "findEmailByUserId">;
}

/** Message overrides for the folder guards (ADR-0076): the three distinct
 *  denials a call site may want to rephrase. */
export interface FolderGuardMessages {
  readonly notFound: string;
  readonly notInOrg: string;
  /** Only surfaced by `loadWritableFolder` (visible but not writable). */
  readonly notWritable: string;
}

const FOLDER_GUARD_MESSAGES: FolderGuardMessages = {
  notFound: FOLDER_MESSAGES.notFound,
  notInOrg: FOLDER_MESSAGES.notAllowed,
  notWritable: "you do not have write access to this folder",
};

/** Does `actor` hold a folder share on `folderId` (ADR-0076)? Mirrors
 *  `hasWriteGrant`: resolve the actor's mirrored email, then match by userId
 *  OR normalized email. */
export async function hasFolderShare(
  folderId: FolderId,
  actor: Pick<TenancyActor, "userId">,
  deps: FolderAccessDeps,
): Promise<Result<boolean, AppError>> {
  const email = await deps.identities.findEmailByUserId(actor.userId);
  if (!email.ok) return email;
  const found = await deps.folderShares.findFor(folderId, {
    userId: actor.userId,
    email: email.value ?? undefined,
  });
  if (!found.ok) return found;
  return ok(found.value !== null);
}

/** The full folder visibility predicate (ADR-0076): the pure broad legs
 *  (owner / legacy / org-visible) plus the share leg. Org scoping is the
 *  caller's business. */
export async function isFolderVisibleTo(
  folder: Folder,
  actor: Pick<TenancyActor, "userId">,
  deps: FolderAccessDeps,
): Promise<Result<boolean, AppError>> {
  if (isFolderBroadlyVisibleTo(folder, actor.userId)) return ok(true);
  return hasFolderShare(folder.id, actor, deps);
}

/** Load a Folder by id for a VISIBILITY-GATED use (the move-report target,
 *  ADR-0076): must exist, not be soft-deleted, be in `actor.orgId` (the
 *  caller decides WHICH org — moveReport passes the report's), and be visible
 *  to the acting user. An invisible same-org folder reads as NotFound —
 *  existence is private. */
export async function loadVisibleFolder(
  folders: FolderRepository,
  actor: TenancyActor,
  folderId: FolderId,
  deps: FolderAccessDeps,
  messages: FolderGuardMessages = FOLDER_GUARD_MESSAGES,
): Promise<Result<Folder, AppError>> {
  const found = await folders.findById(folderId);
  if (!found.ok) return found;
  if (!found.value || found.value.deletedAt !== null) return err(notFound(messages.notFound));
  if (found.value.orgId !== actor.orgId) return err(notAllowed(messages.notInOrg));
  const visible = await isFolderVisibleTo(found.value, actor, deps);
  if (!visible.ok) return visible;
  if (!visible.value) return err(notFound(messages.notFound));
  return ok(found.value);
}

/** Load a Folder by id for SHARING MANAGEMENT (set visibility / share /
 *  unshare / list shares — ADR-0076): owner-or-legacy ONLY. A legacy folder
 *  (ownerId null) is manageable by any org member — that's the adoption/repair
 *  path for pre-ADR-0076 rows; an owned folder is manageable only by its
 *  owner. A visible-but-not-owned folder reads NotAllowed; an invisible one
 *  reads NotFound (existence is private). */
export async function loadManagedFolder(
  folders: FolderRepository,
  actor: TenancyActor,
  folderId: FolderId,
  deps: FolderAccessDeps,
): Promise<Result<Folder, AppError>> {
  const found = await folders.findById(folderId);
  if (!found.ok) return found;
  if (!found.value || found.value.deletedAt !== null) {
    return err(notFound(FOLDER_GUARD_MESSAGES.notFound));
  }
  if (found.value.orgId !== actor.orgId) return err(notAllowed(FOLDER_GUARD_MESSAGES.notInOrg));
  if (found.value.ownerId === null || found.value.ownerId === actor.userId) {
    return ok(found.value);
  }
  const visible = await isFolderVisibleTo(found.value, actor, deps);
  if (!visible.ok) return visible;
  if (!visible.value) return err(notFound(FOLDER_GUARD_MESSAGES.notFound));
  return err(notAllowed("only the folder's owner can manage its sharing"));
}

/** Load a Folder by id for a WRITE (rename / delete / create children —
 *  ADR-0076): `loadVisibleFolder` plus `canWriteFolder` (owner, or anyone for
 *  legacy/org-visible folders). A share-visible folder the actor doesn't own
 *  is NotAllowed — shares grant visibility only. */
export async function loadWritableFolder(
  folders: FolderRepository,
  actor: TenancyActor,
  folderId: FolderId,
  deps: FolderAccessDeps,
  messages: FolderGuardMessages = FOLDER_GUARD_MESSAGES,
): Promise<Result<Folder, AppError>> {
  const found = await loadVisibleFolder(folders, actor, folderId, deps, messages);
  if (!found.ok) return found;
  if (!canWriteFolder(found.value, actor.userId)) return err(notAllowed(messages.notWritable));
  return ok(found.value);
}
