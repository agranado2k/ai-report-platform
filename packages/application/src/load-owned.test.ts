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
import {
  canWrite,
  hasWriteGrant,
  loadOrgReport,
  loadOwnedFolder,
  loadOwnedReport,
  loadReadableReport,
  loadWritableReport,
  type TenancyActor,
  type WriteGrantCheckDeps,
} from "./load-owned";
import type { FolderRepository, ReportRepository } from "./ports";
import {
  InMemoryFolderRepository,
  InMemoryIdentityStore,
  InMemoryReportRepository,
  InMemoryWriteGrantStore,
} from "./testing/in-memory";

const orgA = orgId("00000000-0000-7000-8000-0000000000a1");
const orgB = orgId("00000000-0000-7000-8000-0000000000b1");
const owner = userId("00000000-0000-7000-8000-0000000000d1");
const otherUser = userId("00000000-0000-7000-8000-0000000000d2");

/** The owner acting in their own org — the only combination that exists in prod
 *  today (single-member personal orgs, ADR-0059). */
const ownerActor = { orgId: orgA, userId: owner };
/** A same-org colleague who is NOT the owner (the future company-org case). */
const colleagueActor = { orgId: orgA, userId: otherUser };

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
    uploadedBy: owner,
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

describe("loadOrgReport (reads, ADR-0059 §3)", () => {
  it("returns the report when it exists, is live, and is in the actor's org", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "aaaaaaaaaa"));
    const r = await loadOrgReport(reports, { orgId: orgA }, slug("aaaaaaaaaa"));
    expect(r.ok && r.value.title).toBe("A Title");
  });

  it("rejects an unknown slug with NotFound (default message)", async () => {
    const reports = new InMemoryReportRepository();
    const r = await loadOrgReport(reports, { orgId: orgA }, slug("zzzzzzzzzz"));
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "report not found" });
  });

  it("rejects a soft-deleted report with NotFound", async () => {
    const reports = new InMemoryReportRepository();
    const seeded = report(orgA, "bbbbbbbbbb");
    await reports.save(seeded);
    await reports.softDelete(seeded.id);
    const r = await loadOrgReport(reports, { orgId: orgA }, slug("bbbbbbbbbb"));
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "report not found" });
  });

  it("rejects a cross-org report with NotAllowed (default message)", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "cccccccccc"));
    const r = await loadOrgReport(reports, { orgId: orgB }, slug("cccccccccc"));
    expect(!r.ok && r.error).toEqual({
      kind: "NotAllowed",
      message: "report is not in your org",
    });
  });

  it("passes through a repo-error unchanged", async () => {
    const r = await loadOrgReport(FAILING_REPORTS, { orgId: orgA }, slug("dddddddddd"));
    expect(!r.ok && r.error).toEqual({ kind: "Unexpected", message: "db down" });
  });
});

describe("loadOwnedReport (owner-gated writes, ADR-0059 §2)", () => {
  it("returns the report for its owner", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "aaaaaaaaaa"));
    const r = await loadOwnedReport(reports, ownerActor, slug("aaaaaaaaaa"));
    expect(r.ok && r.value.title).toBe("A Title");
  });

  it("rejects a same-org non-owner with NotAllowed (403, ownership-aware message)", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "cccccccccc"));
    const r = await loadOwnedReport(reports, colleagueActor, slug("cccccccccc"));
    expect(!r.ok && r.error).toEqual({
      kind: "NotAllowed",
      message: "you do not own this report",
    });
  });

  it("rejects a cross-org non-owner with NotAllowed (never 404)", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "eeeeeeeeee"));
    const r = await loadOwnedReport(
      reports,
      { orgId: orgB, userId: otherUser },
      slug("eeeeeeeeee"),
    );
    expect(!r.ok && r.error).toEqual({
      kind: "NotAllowed",
      message: "you do not own this report",
    });
  });

  it("rejects an unknown slug with NotFound", async () => {
    const reports = new InMemoryReportRepository();
    const r = await loadOwnedReport(reports, ownerActor, slug("zzzzzzzzzz"));
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "report not found" });
  });

  it("rejects a soft-deleted report with NotFound", async () => {
    const reports = new InMemoryReportRepository();
    const seeded = report(orgA, "bbbbbbbbbb");
    await reports.save(seeded);
    await reports.softDelete(seeded.id);
    const r = await loadOwnedReport(reports, ownerActor, slug("bbbbbbbbbb"));
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "report not found" });
  });

  it("passes through a repo-error unchanged", async () => {
    const r = await loadOwnedReport(FAILING_REPORTS, ownerActor, slug("dddddddddd"));
    expect(!r.ok && r.error).toEqual({ kind: "Unexpected", message: "db down" });
  });

  it("honors caller-supplied messages", async () => {
    const reports = new InMemoryReportRepository();
    const r = await loadOwnedReport(reports, ownerActor, slug("eeeeeeeeee"), {
      notFound: "custom not found",
      notAllowed: "custom not allowed",
    });
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "custom not found" });
  });
});

function writeDeps(): WriteGrantCheckDeps {
  return { grants: new InMemoryWriteGrantStore(), identities: new InMemoryIdentityStore() };
}

describe("canWrite / hasWriteGrant (ADR-0060 §4: isOwner OR hasWriteGrant)", () => {
  it("the owner can write, with no grant needed", async () => {
    const deps = writeDeps();
    const r = await canWrite(report(orgA, "aaaaaaaaaa"), ownerActor, deps);
    expect(r.ok && r.value).toBe(true);
  });

  it("a same-org non-owner without a grant cannot write", async () => {
    const deps = writeDeps();
    const r = await canWrite(report(orgA, "aaaaaaaaaa"), colleagueActor, deps);
    expect(r.ok && r.value).toBe(false);
  });

  it("ownership is org-agnostic — the owner writes regardless of acting-org context", async () => {
    const ownerInOtherOrg: TenancyActor = { orgId: orgB, userId: owner };
    const r = await canWrite(report(orgA, "aaaaaaaaaa"), ownerInOtherOrg, writeDeps());
    expect(r.ok && r.value).toBe(true);
  });

  it("a cross-org grantee matched by granteeUserId can write (works cross-org)", async () => {
    const grants = new InMemoryWriteGrantStore();
    const grantee = { orgId: orgB, userId: otherUser };
    const rpt = report(orgA, "aaaaaaaaaa");
    await grants.grant(rpt.id, "grantee@x.com", owner, otherUser);
    const deps: WriteGrantCheckDeps = { grants, identities: new InMemoryIdentityStore() };
    const r = await canWrite(rpt, grantee, deps);
    expect(r.ok && r.value).toBe(true);
  });

  it("a grantee resolved only by email (no granteeUserId yet) can write once their email resolves", async () => {
    const grants = new InMemoryWriteGrantStore();
    const identities = new InMemoryIdentityStore();
    const grantee = { orgId: orgB, userId: otherUser };
    const rpt = report(orgA, "aaaaaaaaaa");
    await grants.grant(rpt.id, "grantee@x.com", owner, null); // not signed up at grant time
    identities.seedUser(otherUser, "grantee@x.com"); // signs up later
    const r = await canWrite(rpt, grantee, { grants, identities });
    expect(r.ok && r.value).toBe(true);
  });

  it("hasWriteGrant propagates a grants-store repo error", async () => {
    const rpt = report(orgA, "aaaaaaaaaa");
    const failingGrants = {
      async grant() {
        return err({ kind: "Unexpected" as const, message: "db down" });
      },
      async revoke() {
        return err({ kind: "Unexpected" as const, message: "db down" });
      },
      async listByReport() {
        return err({ kind: "Unexpected" as const, message: "db down" });
      },
      async findFor() {
        return err({ kind: "Unexpected" as const, message: "db down" });
      },
    };
    const r = await hasWriteGrant(rpt.id, colleagueActor, {
      grants: failingGrants,
      identities: new InMemoryIdentityStore(),
    });
    expect(!r.ok && r.error).toEqual({ kind: "Unexpected", message: "db down" });
  });
});

describe("loadWritableReport (rename / re-upload / move seam)", () => {
  it("returns the report for the owner", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "aaaaaaaaaa"));
    const r = await loadWritableReport(reports, ownerActor, slug("aaaaaaaaaa"), writeDeps());
    expect(r.ok && r.value.title).toBe("A Title");
  });

  it("returns the report for a cross-org write-grantee", async () => {
    const reports = new InMemoryReportRepository();
    const seeded = report(orgA, "aaaaaaaaaa");
    await reports.save(seeded);
    const grants = new InMemoryWriteGrantStore();
    await grants.grant(seeded.id, "grantee@x.com", owner, otherUser);
    const r = await loadWritableReport(
      reports,
      { orgId: orgB, userId: otherUser },
      slug("aaaaaaaaaa"),
      {
        grants,
        identities: new InMemoryIdentityStore(),
      },
    );
    expect(r.ok && r.value.title).toBe("A Title");
  });

  it("rejects a non-owner, non-grantee with NotAllowed (write-access message)", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "aaaaaaaaaa"));
    const r = await loadWritableReport(reports, colleagueActor, slug("aaaaaaaaaa"), writeDeps());
    expect(!r.ok && r.error).toEqual({
      kind: "NotAllowed",
      message: "you do not have write access to this report",
    });
  });

  it("rejects an unknown slug with NotFound", async () => {
    const reports = new InMemoryReportRepository();
    const r = await loadWritableReport(reports, ownerActor, slug("zzzzzzzzzz"), writeDeps());
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "report not found" });
  });
});

describe("loadReadableReport (GET seam: org-visible + grantee metadata carve-out)", () => {
  it("returns the report for a same-org actor", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "aaaaaaaaaa"));
    const r = await loadReadableReport(reports, ownerActor, slug("aaaaaaaaaa"), writeDeps());
    expect(r.ok && r.value.title).toBe("A Title");
  });

  it("a same-org non-owner can read metadata too (reads stay org-visible, ADR-0059 §3)", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "aaaaaaaaaa"));
    const r = await loadReadableReport(reports, colleagueActor, slug("aaaaaaaaaa"), writeDeps());
    expect(r.ok && r.value.title).toBe("A Title");
  });

  it("a cross-org write-grantee can read the report's metadata (ADR-0060 §4 carve-out)", async () => {
    const reports = new InMemoryReportRepository();
    const seeded = report(orgA, "aaaaaaaaaa");
    await reports.save(seeded);
    const grants = new InMemoryWriteGrantStore();
    await grants.grant(seeded.id, "grantee@x.com", owner, otherUser);
    const r = await loadReadableReport(
      reports,
      { orgId: orgB, userId: otherUser },
      slug("aaaaaaaaaa"),
      { grants, identities: new InMemoryIdentityStore() },
    );
    expect(r.ok && r.value.title).toBe("A Title");
  });

  it("rejects a cross-org non-grantee with NotAllowed", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "aaaaaaaaaa"));
    const r = await loadReadableReport(
      reports,
      { orgId: orgB, userId: otherUser },
      slug("aaaaaaaaaa"),
      writeDeps(),
    );
    expect(!r.ok && r.error).toEqual({ kind: "NotAllowed", message: "report is not in your org" });
  });

  it("the OWNER reads regardless of acting-org context — read/write symmetry (review #150)", async () => {
    const reports = new InMemoryReportRepository();
    await reports.save(report(orgA, "aaaaaaaaaa"));
    // Owner acting under a different active org: canWrite is owner-first and
    // org-agnostic, so the GET seam must be too — otherwise a multi-org owner
    // could rename a report they cannot GET.
    const r = await loadReadableReport(
      reports,
      { orgId: orgB, userId: owner },
      slug("aaaaaaaaaa"),
      writeDeps(),
    );
    expect(r.ok && r.value.title).toBe("A Title");
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
