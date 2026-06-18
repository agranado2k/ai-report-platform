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
import { InMemoryFolderRepository, InMemoryReportRepository } from "../testing/in-memory";
import { deleteFolder } from "./delete-folder";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b1");
const ROOT = "00000000-0000-7000-8000-0000000000a0";
const SUB = "00000000-0000-7000-8000-0000000000a2";

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error("bad slug");
  return r.value;
}
function folder(id: string, org: typeof orgA, parentId: string | null, name: string): Folder {
  const r = createFolder({
    id: folderId(id),
    orgId: org,
    parentId: parentId ? folderId(parentId) : null,
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
  const folders = new InMemoryFolderRepository();
  const reports = new InMemoryReportRepository();
  await folders.save(folder(ROOT, orgA, null, "Root"));
  await folders.save(folder(SUB, orgA, ROOT, "Sub"));
  return { folders, reports };
}

describe("deleteFolder use case", () => {
  it("soft-deletes an empty folder (excluded from listByOrg)", async () => {
    const { folders, reports } = await setup();
    const r = await deleteFolder(
      { folders, reports },
      { orgId: orgA },
      { folderId: folderId(SUB) },
    );
    expect(r.ok).toBe(true);
    const list = await folders.listByOrg(orgA);
    expect(list.ok && list.value.some((f) => f.id === SUB)).toBe(false);
  });

  it("refuses to delete the Root folder", async () => {
    const { folders, reports } = await setup();
    const r = await deleteFolder(
      { folders, reports },
      { orgId: orgA },
      { folderId: folderId(ROOT) },
    );
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("refuses a folder that contains a report", async () => {
    const { folders, reports } = await setup();
    await reports.save(reportIn(orgA, SUB, "aaaaaaaaaa"));
    const r = await deleteFolder(
      { folders, reports },
      { orgId: orgA },
      { folderId: folderId(SUB) },
    );
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("refuses a folder that contains a subfolder", async () => {
    const { folders, reports } = await setup();
    await folders.save(folder("00000000-0000-7000-8000-0000000000a3", orgA, SUB, "Nested"));
    const r = await deleteFolder(
      { folders, reports },
      { orgId: orgA },
      { folderId: folderId(SUB) },
    );
    expect(!r.ok && r.error.kind).toBe("ValidationError");
  });

  it("rejects a cross-org folder with NotAllowed", async () => {
    const { folders, reports } = await setup();
    const r = await deleteFolder(
      { folders, reports },
      { orgId: orgB },
      { folderId: folderId(SUB) },
    );
    expect(!r.ok && r.error.kind).toBe("NotAllowed");
  });

  it("rejects an unknown folder with NotFound", async () => {
    const { folders, reports } = await setup();
    const r = await deleteFolder(
      { folders, reports },
      { orgId: orgA },
      { folderId: folderId("00000000-0000-7000-8000-00000000dead") },
    );
    expect(!r.ok && r.error.kind).toBe("NotFound");
  });
});
