// Shared use-case test fixtures — the one place the "createReport literal +
// orgA/owner UUID constants + local makeDeps()" trio that used to be duplicated
// across ~39 use-case test files is defined.
//
// THE PATTERN (adopt opportunistically when touching a use-case test file):
//   import { ACTORS, ownerActor, report, slug, makeWriteSeamDeps } from "../testing/fixtures";
//   - `ACTORS` / `ownerActor` / `colleagueActor` replace the per-file
//     `00000000-0000-7000-8000-0000000000a1`-style org/user constants.
//   - `report(org, "aaaaaaaaaa")` replaces the local `createReport` literal —
//     same derived id (`…00${slug.slice(0, 2)}`), same one-pending-version shape;
//     override `title`/`ownerId`/`folderId` only where a test asserts on them.
//   - `slug("aaaaaaaaaa")` replaces the local makeSlug-unwrap helper.
//   - The `make*Deps()` builders replace the local `makeDeps()`/`writeDeps()`
//     functions, one per prevailing deps shape (see each builder's doc).
// Files already migrated (the reference examples): add-comment.test.ts,
// rename-report.test.ts, move-report.test.ts, delete-report.test.ts,
// load-owned.test.ts.
import {
  createFolder,
  createReport,
  type Folder,
  type FolderId,
  folderId,
  makeSlug,
  type OrgId,
  orgId,
  type Report,
  reportId,
  type Slug,
  type UserId,
  userId,
  versionId,
} from "arp-domain";
import {
  FixedClock,
  InMemoryAuditLogger,
  InMemoryCommentRepository,
  InMemoryEventOutbox,
  InMemoryFolderShareStore,
  InMemoryIdentityStore,
  InMemoryReportRepository,
  InMemoryWriteGrantStore,
  idempotencyTestDeps,
  PassThroughUnitOfWork,
  SequentialIdGenerator,
} from "./in-memory";

/** The shared actor UUIDs the use-case tests speak in: two orgs (A owns the
 *  fixtures, B is the cross-org foil), the report owner, and a non-owner. */
export const ACTORS = {
  orgA: orgId("00000000-0000-7000-8000-0000000000a1"),
  orgB: orgId("00000000-0000-7000-8000-0000000000b1"),
  owner: userId("00000000-0000-7000-8000-0000000000d1"),
  otherUser: userId("00000000-0000-7000-8000-0000000000d2"),
} as const;

/** The owner acting in their own org — the only combination that exists in prod
 *  today (single-member personal orgs, ADR-0059). */
export const ownerActor = { orgId: ACTORS.orgA, userId: ACTORS.owner } as const;
/** A same-org colleague who is NOT the owner (the future company-org case). */
export const colleagueActor = { orgId: ACTORS.orgA, userId: ACTORS.otherUser } as const;

/** The folder every {@link report} fixture lives in unless overridden. */
export const ROOT_FOLDER_ID = folderId("00000000-0000-7000-8000-0000000000a0");
/** The v1 VersionId every {@link report} fixture is created with. */
export const FIRST_VERSION_ID = versionId("00000000-0000-7000-8000-0000000000e1");

/** Unwrap a known-good 10-char slug (throws on a typo'd fixture, never in prod). */
export function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error(`bad fixture slug: ${s}`);
  return r.value;
}

export interface ReportOverrides {
  readonly title?: string;
  readonly ownerId?: UserId;
  readonly folderId?: FolderId;
}

/**
 * The prevailing Report fixture: one pending version, id derived from the slug
 * (`…00${slug.slice(0, 2)}` — so distinct slugs give distinct, predictable ids),
 * owned by {@link ACTORS.owner} in {@link ROOT_FOLDER_ID} unless overridden.
 */
export function report(org: OrgId, slugStr: string, overrides: ReportOverrides = {}): Report {
  return createReport({
    id: reportId(`00000000-0000-7000-8000-0000000000${slugStr.slice(0, 2)}`),
    orgId: org,
    folderId: overrides.folderId ?? ROOT_FOLDER_ID,
    slug: slug(slugStr),
    title: overrides.title ?? "A Title",
    versionId: FIRST_VERSION_ID,
    contentHash: "h".repeat(64),
    uploadedBy: overrides.ownerId ?? ACTORS.owner,
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  }).report;
}

/** A root-level Folder fixture (unwraps createFolder; throws only on a bad
 *  fixture). Legacy shape by default (ownerId null, org-visible) — the
 *  pre-ADR-0076 semantics most existing tests assume; override where a test
 *  asserts on ownership/visibility. */
export function folder(
  id: string,
  org: OrgId,
  name: string,
  overrides: Partial<Pick<Folder, "parentId" | "ownerId" | "visibility">> = {},
): Folder {
  const r = createFolder({
    id: folderId(id),
    orgId: org,
    parentId: overrides.parentId ?? null,
    ownerId: overrides.ownerId ?? null,
    visibility: overrides.visibility ?? "org",
    name,
  });
  if (!r.ok) throw new Error(`bad fixture folder: ${name}`);
  return r.value;
}

/** The `WriteGrantCheckDeps` pair (canWrite / hasWriteGrant, ADR-0060 §4). */
export function makeGrantCheckDeps() {
  return { grants: new InMemoryWriteGrantStore(), identities: new InMemoryIdentityStore() };
}

/** The `FolderAccessDeps` pair (folder visibility / write guards, ADR-0076). */
export function makeFolderAccessDeps() {
  return { folderShares: new InMemoryFolderShareStore(), identities: new InMemoryIdentityStore() };
}

/** The write-seam quartet shared by rename/move/re-upload-shaped use cases:
 *  grant check + audit + uow + idempotency (ADR-0039) — each test supplies its
 *  own repositories. */
export function makeWriteSeamDeps() {
  return {
    ...makeGrantCheckDeps(),
    // The ADR-0076 folder-share store (moveReport's target-visibility check);
    // inert for use cases that don't touch folders.
    folderShares: new InMemoryFolderShareStore(),
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
    ...idempotencyTestDeps(),
  };
}

/** The owner-only mutation trio (delete-report shape): reports + audit + uow,
 *  plus the idempotency pair every mutating use case takes (ADR-0039). */
export function makeOwnerMutationDeps() {
  return {
    reports: new InMemoryReportRepository(),
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
    ...idempotencyTestDeps(),
  };
}

/** The comment-authoring deps (add/reply/resolve/edit-comment shape, ADR-0064):
 *  clock fixed at 1000 so `createdAt`/`resolvedAt` assertions stay literal;
 *  includes the idempotency pair every mutating use case takes (ADR-0039). */
export function makeCommentDeps() {
  return {
    reports: new InMemoryReportRepository(),
    comments: new InMemoryCommentRepository(),
    ids: new SequentialIdGenerator(),
    clock: new FixedClock(1000),
    outbox: new InMemoryEventOutbox(),
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
    grants: new InMemoryWriteGrantStore(),
    identities: new InMemoryIdentityStore(),
    ...idempotencyTestDeps(),
  };
}
