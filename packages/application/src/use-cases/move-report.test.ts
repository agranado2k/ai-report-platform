import { folderId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  ACTORS,
  folder,
  ownerActor,
  report,
  ROOT_FOLDER_ID as rootA,
  slug,
  makeWriteSeamDeps as writeDeps,
} from "../testing/fixtures";
import { InMemoryFolderRepository, InMemoryReportRepository } from "../testing/in-memory";
import { moveReport } from "./move-report";

const { orgA, orgB, owner, otherUser } = ACTORS;

async function setup() {
  const reports = new InMemoryReportRepository();
  const folders = new InMemoryFolderRepository();
  const targetA = folder("00000000-0000-7000-8000-0000000000a2", orgA, "Target A");
  const targetB = folder("00000000-0000-7000-8000-0000000000b2", orgB, "Target B");
  await folders.save(targetA);
  await folders.save(targetB);
  return { reports, folders, targetA, targetB };
}

describe("moveReport use case", () => {
  it("moves a report into a target folder in the same org", async () => {
    const { reports, folders, targetA } = await setup();
    await reports.save(report(orgA, "aaaaaaaaaa"));

    const r = await moveReport({ reports, folders, ...writeDeps() }, ownerActor, {
      slug: slug("aaaaaaaaaa"),
      toFolderId: targetA.id,
    });
    expect(r.ok).toBe(true);

    const after = await reports.findBySlug(slug("aaaaaaaaaa"));
    expect(after.ok && after.value?.folderId).toBe(targetA.id);
  });

  it("rejects a non-owner without a write grant with NotAllowed (canWrite, ADR-0059/0060)", async () => {
    const { reports, folders, targetA } = await setup();
    await reports.save(report(orgA, "bbbbbbbbbb"));

    const r = await moveReport(
      { reports, folders, ...writeDeps() },
      { orgId: orgA, userId: otherUser },
      {
        slug: slug("bbbbbbbbbb"),
        toFolderId: targetA.id,
      },
    );
    expect(!r.ok && r.error).toEqual({
      kind: "NotAllowed",
      message: "you do not have write access to this report",
    });
  });

  it("rejects a target folder outside the REPORT's org (NotAllowed, ADR-0059 §2)", async () => {
    const { reports, folders, targetB } = await setup();
    await reports.save(report(orgA, "cccccccccc"));

    const r = await moveReport({ reports, folders, ...writeDeps() }, ownerActor, {
      slug: slug("cccccccccc"),
      toFolderId: targetB.id, // org B's folder
    });
    expect(!r.ok && r.error).toEqual({
      kind: "NotAllowed",
      message: "target folder is not in the report's org",
    });
  });

  it("rejects an unknown report (NotFound)", async () => {
    const { reports, folders, targetA } = await setup();
    const r = await moveReport({ reports, folders, ...writeDeps() }, ownerActor, {
      slug: slug("zzzzzzzzzz"),
      toFolderId: targetA.id,
    });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("rejects an unknown target folder (NotFound)", async () => {
    const { reports, folders } = await setup();
    await reports.save(report(orgA, "dddddddddd"));

    const r = await moveReport({ reports, folders, ...writeDeps() }, ownerActor, {
      slug: slug("dddddddddd"),
      toFolderId: folderId("00000000-0000-7000-8000-00000000dead"),
    });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("rejects a soft-deleted target folder (NotFound)", async () => {
    const { reports, folders } = await setup();
    await reports.save(report(orgA, "eeeeeeeeee"));
    const deleted = {
      ...folder("00000000-0000-7000-8000-0000000000a3", orgA, "Deleted"),
      deletedAt: 1,
    };
    await folders.save(deleted);

    const r = await moveReport({ reports, folders, ...writeDeps() }, ownerActor, {
      slug: slug("eeeeeeeeee"),
      toFolderId: deleted.id,
    });
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });

  it("preserves the report's versions on move", async () => {
    const { reports, folders, targetA } = await setup();
    await reports.save(report(orgA, "ffffffffff"));
    const before = await reports.findBySlug(slug("ffffffffff"));
    const beforeCount = before.ok && before.value ? before.value.versions.length : -1;

    await moveReport({ reports, folders, ...writeDeps() }, ownerActor, {
      slug: slug("ffffffffff"),
      toFolderId: targetA.id,
    });

    const after = await reports.findBySlug(slug("ffffffffff"));
    expect(after.ok && after.value?.folderId).toBe(targetA.id);
    expect(after.ok && after.value?.versions.length).toBe(beforeCount);
  });

  it("records a report.moved audit entry alongside the move (ADR-0070)", async () => {
    const { reports, folders, targetA } = await setup();
    const toMove = report(orgA, "gggggggggg");
    await reports.save(toMove);
    const deps = { reports, folders, ...writeDeps() };

    const r = await moveReport(deps, ownerActor, {
      slug: slug("gggggggggg"),
      toFolderId: targetA.id,
    });
    expect(r.ok).toBe(true);
    expect(deps.audit.recorded()).toContainEqual({
      action: "report.moved",
      orgId: orgA,
      actorUserId: owner,
      targetType: "report",
      targetId: toMove.id,
      meta: { fromFolderId: rootA, toFolderId: targetA.id },
    });
  });
});

describe("moveReport target visibility (ADR-0076)", () => {
  it("allows moving into the actor's OWN private folder", async () => {
    const { reports, folders } = await setup();
    const mine = folder("00000000-0000-7000-8000-0000000000a5", orgA, "My private", {
      ownerId: owner,
      visibility: "private",
    });
    await folders.save(mine);
    await reports.save(report(orgA, "hhhhhhhhhh"));
    const r = await moveReport({ reports, folders, ...writeDeps() }, ownerActor, {
      slug: slug("hhhhhhhhhh"),
      toFolderId: mine.id,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects another user's PRIVATE folder as a target with NotFound — not resolvable", async () => {
    const { reports, folders } = await setup();
    const theirs = folder("00000000-0000-7000-8000-0000000000a6", orgA, "Their private", {
      ownerId: otherUser,
      visibility: "private",
    });
    await folders.save(theirs);
    await reports.save(report(orgA, "jjjjjjjjjj"));
    const r = await moveReport({ reports, folders, ...writeDeps() }, ownerActor, {
      slug: slug("jjjjjjjjjj"),
      toFolderId: theirs.id,
    });
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "target folder not found" });
  });

  it("allows a SHARE-VISIBLE private folder as a target (shares grant visibility)", async () => {
    const { reports, folders } = await setup();
    const deps = { reports, folders, ...writeDeps() };
    const theirs = folder("00000000-0000-7000-8000-0000000000a7", orgA, "Shared private", {
      ownerId: otherUser,
      visibility: "private",
    });
    await folders.save(theirs);
    await deps.folderShares.grant(theirs.id, "x@test.local", otherUser, owner);
    await reports.save(report(orgA, "kkkkkkkkkk"));
    const r = await moveReport(deps, ownerActor, {
      slug: slug("kkkkkkkkkk"),
      toFolderId: theirs.id,
    });
    expect(r.ok).toBe(true);
  });
});

describe("moveReport idempotency (ADR-0039)", () => {
  it("replays the recorded moved-report resource on an identical retry — one audit row", async () => {
    const reports = new InMemoryReportRepository();
    const folders = new InMemoryFolderRepository();
    await folders.save(folder("00000000-0000-7000-8000-0000000000a0", orgA, "Root"));
    await folders.save(folder("00000000-0000-7000-8000-0000000000a9", orgA, "Dest"));
    await reports.save(report(orgA, "iiiiiiiiii"));
    const deps = { reports, folders, ...writeDeps() };
    const input = {
      slug: slug("iiiiiiiiii"),
      toFolderId: folderId("00000000-0000-7000-8000-0000000000a9"),
    };
    const first = await moveReport(deps, ownerActor, input);
    const second = await moveReport(deps, ownerActor, input);
    expect(first.ok && first.value.folderId).toBe(input.toFolderId);
    expect(second.ok && second.value.folderId).toBe(input.toFolderId);
    expect(deps.audit.recorded().length).toBe(1);
  });
});

// ── Move stays ACL-neutral (ADR-0078 §7) ───────────────────────────────────
// A deliberate decision, not an omission. moveReport is gated on `canWrite`,
// NOT on ownership — so a write grantee, who may be cross-org and who by
// ADR-0060 §6 has no view access at all, can move a report. If a move applied
// the destination folder's sharing, that grantee could publish a report they
// cannot read into an org-visible folder: exactly the write→read composition
// ADR-0060 §6 forbids. Inheritance is therefore a CREATE-time rule only.
describe("moveReport leaves sharing alone (ADR-0078 §7)", () => {
  it("moving a PRIVATE report into an ORG-visible folder does NOT publish it", async () => {
    const reports = new InMemoryReportRepository();
    const folders = new InMemoryFolderRepository();
    const shared = folder("00000000-0000-7000-8000-0000000000a3", orgA, "Shared", {
      parentId: folderId("00000000-0000-7000-8000-0000000000a0"),
      ownerId: owner,
      visibility: "org",
    });
    await folders.save(shared);
    const rpt = report(orgA, "mmmmmmmmmm");
    await reports.save(rpt);
    const deps = { reports, folders, ...writeDeps() };

    const r = await moveReport(deps, ownerActor, {
      slug: slug("mmmmmmmmmm"),
      toFolderId: shared.id,
    });
    expect(r.ok).toBe(true);
    const after = await reports.findById(rpt.id);
    expect(after.ok && after.value?.acl.mode).toBe("private");
  });

  it("moving an ORG-shared report into a PRIVATE folder does NOT un-share it", async () => {
    const reports = new InMemoryReportRepository();
    const folders = new InMemoryFolderRepository();
    const hidden = folder("00000000-0000-7000-8000-0000000000a4", orgA, "Hidden", {
      parentId: folderId("00000000-0000-7000-8000-0000000000a0"),
      ownerId: owner,
      visibility: "private",
    });
    await folders.save(hidden);
    const rpt = report(orgA, "nnnnnnnnnn");
    await reports.save(rpt);
    await reports.setAcl(rpt.id, { mode: "org" });
    const deps = { reports, folders, ...writeDeps() };

    const r = await moveReport(deps, ownerActor, {
      slug: slug("nnnnnnnnnn"),
      toFolderId: hidden.id,
    });
    expect(r.ok).toBe(true);
    const after = await reports.findById(rpt.id);
    expect(after.ok && after.value?.acl.mode).toBe("org");
  });
});
