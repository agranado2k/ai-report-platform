import {
  createFolder,
  createReport,
  type Folder,
  type FolderVisibility,
  folderId,
  makeSlug,
  orgId,
  type Report,
  reportId,
  type Slug,
  userId,
  versionId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import { makeFolderAccessDeps } from "../testing/fixtures";
import {
  InMemoryAuditLogger,
  InMemoryFolderRepository,
  InMemoryReportRepository,
  idempotencyTestDeps,
  PassThroughUnitOfWork,
} from "../testing/in-memory";
import { deleteFolder } from "./delete-folder";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b1");
const ROOT = "00000000-0000-7000-8000-0000000000a0";
const SUB = "00000000-0000-7000-8000-0000000000a2";
const actorA = userId("00000000-0000-7000-8000-0000000000d1");

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}
function folder(
  id: string,
  org: typeof orgA,
  parentId: string | null,
  name: string,
  ownerId: ReturnType<typeof userId> | null = null,
  visibility: FolderVisibility = "org",
): Folder {
  const r = createFolder({
    id: folderId(id),
    orgId: org,
    parentId: parentId ? folderId(parentId) : null,
    ownerId,
    visibility,
    name,
  });
  if (!r.ok) throw new Error("bad folder");
  return r.value;
}
function reportIn(org: typeof orgA, fId: string, slugStr: string): Report {
  return createReport({
    id: reportId(`00000000-0000-7000-8000-0000000000${slugStr.slice(0, 2)}`),
    orgId: org,
    folderId: folderId(fId),
    slug: slug(slugStr),
    title: "A report",
    versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
    contentHash: "h".repeat(64),
    uploadedBy: userId("00000000-0000-7000-8000-0000000000d1"),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  }).report;
}

async function setup() {
  const access = makeFolderAccessDeps();
  const folders = new InMemoryFolderRepository(access.folderShares);
  const reports = new InMemoryReportRepository();
  await folders.save(folder(ROOT, orgA, null, "Root"));
  await folders.save(folder(SUB, orgA, ROOT, "Sub"));
  return {
    folders,
    reports,
    audit: new InMemoryAuditLogger(),
    uow: new PassThroughUnitOfWork(),
    ...access,
    ...idempotencyTestDeps(),
  };
}

describe("deleteFolder use case", () => {
  it("soft-deletes an empty folder (excluded from listByOrg)", async () => {
    const { folders, reports, audit, uow, folderShares, identities } = await setup();
    const r = await deleteFolder(
      { folders, reports, audit, uow, folderShares, identities, ...idempotencyTestDeps() },
      { orgId: orgA, userId: actorA },
      { folderId: folderId(SUB) },
    );
    expect(r.ok).toBe(true);
    const list = await folders.listByOrg(orgA, { userId: actorA });
    expect(list.ok && list.value.some((f) => f.id === SUB)).toBe(false);
  });

  it("refuses to delete the Root folder", async () => {
    const { folders, reports, audit, uow, folderShares, identities } = await setup();
    const r = await deleteFolder(
      { folders, reports, audit, uow, folderShares, identities, ...idempotencyTestDeps() },
      { orgId: orgA, userId: actorA },
      { folderId: folderId(ROOT) },
    );
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("refuses a folder that contains a report", async () => {
    const { folders, reports, audit, uow, folderShares, identities } = await setup();
    await reports.save(reportIn(orgA, SUB, "aaaaaaaaaa"));
    const r = await deleteFolder(
      { folders, reports, audit, uow, folderShares, identities, ...idempotencyTestDeps() },
      { orgId: orgA, userId: actorA },
      { folderId: folderId(SUB) },
    );
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("refuses a folder that contains a subfolder", async () => {
    const { folders, reports, audit, uow, folderShares, identities } = await setup();
    await folders.save(folder("00000000-0000-7000-8000-0000000000a3", orgA, SUB, "Nested"));
    const r = await deleteFolder(
      { folders, reports, audit, uow, folderShares, identities, ...idempotencyTestDeps() },
      { orgId: orgA, userId: actorA },
      { folderId: folderId(SUB) },
    );
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("rejects a cross-org folder with NotAllowed", async () => {
    const { folders, reports, audit, uow, folderShares, identities } = await setup();
    const r = await deleteFolder(
      { folders, reports, audit, uow, folderShares, identities, ...idempotencyTestDeps() },
      { orgId: orgB, userId: actorA },
      { folderId: folderId(SUB) },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("rejects an unknown folder with NotFound", async () => {
    const { folders, reports, audit, uow, folderShares, identities } = await setup();
    const r = await deleteFolder(
      { folders, reports, audit, uow, folderShares, identities, ...idempotencyTestDeps() },
      { orgId: orgA, userId: actorA },
      { folderId: folderId("00000000-0000-7000-8000-00000000dead") },
    );
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("records a folder.deleted audit entry alongside the soft-delete (ADR-0070)", async () => {
    const { folders, reports, audit, uow, folderShares, identities } = await setup();
    const r = await deleteFolder(
      { folders, reports, audit, uow, folderShares, identities, ...idempotencyTestDeps() },
      { orgId: orgA, userId: actorA },
      { folderId: folderId(SUB) },
    );
    expect(r.ok).toBe(true);
    expect(audit.recorded()).toContainEqual({
      action: "folder.deleted",
      orgId: orgA,
      actorUserId: actorA,
      targetType: "folder",
      targetId: folderId(SUB),
    });
  });
});

describe("deleteFolder visibility scoping (ADR-0076)", () => {
  const otherUser = userId("00000000-0000-7000-8000-0000000000d2");
  const PRIV = "00000000-0000-7000-8000-0000000000a4";

  it("another user's PRIVATE folder reads NotFound — existence is private", async () => {
    const d = await setup();
    await d.folders.save(folder(PRIV, orgA, ROOT, "Theirs", otherUser, "private"));
    const r = await deleteFolder(d, { orgId: orgA, userId: actorA }, { folderId: folderId(PRIV) });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("an INVISIBLE private subfolder still blocks the delete (guard not visibility-scoped)", async () => {
    const d = await setup();
    // Someone else's private subfolder inside SUB — actorA can't see it, but
    // the emptiness guard must still refuse.
    await d.folders.save(folder(PRIV, orgA, SUB, "Hidden sub", otherUser, "private"));
    const r = await deleteFolder(d, { orgId: orgA, userId: actorA }, { folderId: folderId(SUB) });
    expect(!r.ok && r.error.kind).toBe("ValidationError");
    expect(!r.ok && r.error.message).toContain("subfolders");
  });
});

describe("deleteFolder idempotency (ADR-0039)", () => {
  it("re-applies on an identical KEYLESS retry — no derived-key replay (#233)", async () => {
    const deps = await setup();
    const actor = { orgId: orgA, userId: actorA };
    const first = await deleteFolder(deps, actor, { folderId: folderId(SUB) });
    const second = await deleteFolder(deps, actor, { folderId: folderId(SUB) });
    expect(first.ok).toBe(true);
    // #233: the keyless retry now really RUNS. For a delete-shaped operation
    // that means the second call fails (the thing is already gone) instead of
    // replaying a recorded 204. That is the point: the derived key could
    // otherwise be burned BEFORE the fact, making the real delete a no-op.
    // A client that wants exactly-once retry semantics sends an
    // Idempotency-Key, which still claims and replays as before.
    expect(second.ok).toBe(false);
    expect(deps.audit.recorded().length).toBe(1);
  });
});
