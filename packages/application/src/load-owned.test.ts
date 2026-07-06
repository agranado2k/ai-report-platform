import {
  createFolder,
  createReport,
  err,
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
import { loadOwnedFolder, loadOwnedReport } from "./load-owned";
import type { FolderRepository, ReportRepository } from "./ports";
import { InMemoryFolderRepository, InMemoryReportRepository } from "./testing/in-memory";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b1");

function slug(s: string): Slug {
  const r = makeSlug(s);
  if (!r.ok) throw new Error(`bad slug ${s}`);
  return r.value;
}

function report(org: typeof orgA, slugStr: string): Report {
  return createReport({
    id: reportId(`00000000-0000-7000-8000-0000000000${slugStr.slice(0, 2)}`),
    orgId: org,
    folderId: folderId("00000000-0000-7000-8000-0000000000a0"),
    slug: slug(slugStr),
    title: "A Title",
    versionId: versionId("00000000-0000-7000-8000-0000000000e1"),
    contentHash: "h".repeat(64),
    uploadedBy: userId("00000000-0000-7000-8000-0000000000d1"),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 1,
  }).report;
}

function folder(id: string, org: typeof orgA, name: string): Folder {
  const r = createFolder({ id: folderId(id), orgId: org, parentId: null, name });
  if (!r.ok) throw new Error("bad folder");
  return r.value;
}

const FAILING_REPORTS: ReportRepository = {
  async findBySlug() {
    return err({ kind: "Unexpected", message: "db down" });
  },
  async findById() {
    return err({ kind: "Unexpected", message: "db down" });
  },
  async listByOrg() {
    return err({ kind: "Unexpected", message: "db down" });
  },
  async searchByOrg() {
    return err({ kind: "Unexpected", message: "db down" });
  },
  async save() {
    return err({ kind: "Unexpected", message: "db down" });
  },
  async softDelete() {
    return err({ kind: "Unexpected", message: "db down" });
  },
  async setAcl() {
    return err({ kind: "Unexpected", message: "db down" });
  },
};

const FAILING_FOLDERS: FolderRepository = {
  async listByOrg() {
    return err({ kind: "Unexpected", message: "db down" });
  },
  async searchByOrg() {
    return err({ kind: "Unexpected", message: "db down" });
  },
  async findById() {
    return err({ kind: "Unexpected", message: "db down" });
  },
  async save() {
    return err({ kind: "Unexpected", message: "db down" });
  },
  async softDelete() {
    return err({ kind: "Unexpected", message: "db down" });
  },
};

describe("loadOwnedReport", () => {
  it("returns the report when it exists, is live, and is in the actor's org", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "aaaaaaaaaa"));
    const r = await loadOwnedReport(reports, { orgId: orgA }, slug("aaaaaaaaaa"));
    expect(r.ok && r.value.title).toBe("A Title");
  });

  it("rejects an unknown slug with NotFound (default message)", async () => {
    const reports = new InMemoryReportRepository();
    const r = await loadOwnedReport(reports, { orgId: orgA }, slug("zzzzzzzzzz"));
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "report not found" });
  });

  it("rejects a soft-deleted report with NotFound", async () => {
    const reports = new InMemoryReportRepository();
    const seeded = report(orgA, "bbbbbbbbbb");
    await reports.save(seeded);
    await reports.softDelete(seeded.id);
    const r = await loadOwnedReport(reports, { orgId: orgA }, slug("bbbbbbbbbb"));
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "report not found" });
  });

  it("rejects a cross-org report with NotAllowed (default message)", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "cccccccccc"));
    const r = await loadOwnedReport(reports, { orgId: orgB }, slug("cccccccccc"));
    expect(!r.ok && r.error).toEqual({
      kind: "NotAllowed",
      message: "report is not in your org",
    });
  });

  it("passes through a repo-error unchanged", async () => {
    const r = await loadOwnedReport(FAILING_REPORTS, { orgId: orgA }, slug("dddddddddd"));
    expect(!r.ok && r.error).toEqual({ kind: "Unexpected", message: "db down" });
  });

  it("honors caller-supplied messages (e.g. move-report's target-folder text)", async () => {
    const reports = new InMemoryReportRepository();
    const r = await loadOwnedReport(reports, { orgId: orgA }, slug("eeeeeeeeee"), {
      notFound: "custom not found",
      notAllowed: "custom not allowed",
    });
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "custom not found" });
  });
});

describe("loadOwnedFolder", () => {
  const F1 = "00000000-0000-7000-8000-0000000000f1";

  it("returns the folder when it exists, is live, and is in the actor's org", async () => {
    const folders = new InMemoryFolderRepository();
    await folders.save(folder(F1, orgA, "Docs"));
    const r = await loadOwnedFolder(folders, { orgId: orgA }, folderId(F1));
    expect(r.ok && r.value.name).toBe("Docs");
  });

  it("rejects an unknown folder id with NotFound (default message)", async () => {
    const folders = new InMemoryFolderRepository();
    const r = await loadOwnedFolder(
      folders,
      { orgId: orgA },
      folderId("00000000-0000-7000-8000-00000000dead"),
    );
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "folder not found" });
  });

  it("rejects a soft-deleted folder with NotFound", async () => {
    const folders = new InMemoryFolderRepository();
    await folders.save(folder(F1, orgA, "Docs"));
    await folders.softDelete(folderId(F1));
    const r = await loadOwnedFolder(folders, { orgId: orgA }, folderId(F1));
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "folder not found" });
  });

  it("rejects a cross-org folder with NotAllowed (default message)", async () => {
    const folders = new InMemoryFolderRepository();
    await folders.save(folder(F1, orgA, "Docs"));
    const r = await loadOwnedFolder(folders, { orgId: orgB }, folderId(F1));
    expect(!r.ok && r.error).toEqual({ kind: "NotAllowed", message: "folder is not in your org" });
  });

  it("passes through a repo-error unchanged", async () => {
    const r = await loadOwnedFolder(FAILING_FOLDERS, { orgId: orgA }, folderId(F1));
    expect(!r.ok && r.error).toEqual({ kind: "Unexpected", message: "db down" });
  });

  it("honors caller-supplied messages (e.g. move-report's target-folder text)", async () => {
    const folders = new InMemoryFolderRepository();
    const r = await loadOwnedFolder(folders, { orgId: orgA }, folderId(F1), {
      notFound: "target folder not found",
      notAllowed: "target folder is not in your org",
    });
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "target folder not found" });
  });
});
