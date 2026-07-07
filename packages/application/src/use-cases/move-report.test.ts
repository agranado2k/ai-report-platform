import {
  createFolder,
  createReport,
  type Folder,
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
import {
  InMemoryFolderRepository,
  InMemoryIdentityStore,
  InMemoryReportRepository,
  InMemoryWriteGrantStore,
} from "../testing/in-memory";
import { moveReport } from "./move-report";

const writeDeps = () => ({
  grants: new InMemoryWriteGrantStore(),
  identities: new InMemoryIdentityStore(),
});

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b1");
const owner = userId("00000000-0000-7000-8000-0000000000d1");
const otherUser = userId("00000000-0000-7000-8000-0000000000d2");
const ownerActor = { orgId: orgA, userId: owner };
const rootA = folderId("00000000-0000-7000-8000-0000000000a0");

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error(`bad slug ${s}`);
  return r.value;
}

function folder(id: string, org: typeof orgA, name: string): Folder {
  const r = createFolder({ id: folderId(id), orgId: org, parentId: null, name });
  if (!r.ok) throw new Error("bad folder");
  return r.value;
}

function report(org: typeof orgA, slugStr: string): Report {
  return createReport({
    id: reportId(`00000000-0000-7000-8000-0000000000${slugStr.slice(0, 2)}`),
    orgId: org,
    folderId: rootA,
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
});
