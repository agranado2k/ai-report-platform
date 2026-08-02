import { err, folderId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  canWrite,
  hasWriteGrant,
  loadManagedFolder,
  loadOrgReport,
  loadOwnedReport,
  loadReadableReport,
  loadVisibleFolder,
  loadWritableFolder,
  loadWritableReport,
  type TenancyActor,
  type WriteGrantCheckDeps,
} from "./load-owned";
import type { FolderRepository, ReportRepository } from "./ports";
import {
  ACTORS,
  colleagueActor,
  folder,
  makeFolderAccessDeps,
  makeGrantCheckDeps,
  ownerActor,
  report,
  slug,
} from "./testing/fixtures";
import {
  InMemoryFolderRepository,
  InMemoryIdentityStore,
  InMemoryReportRepository,
  InMemoryWriteGrantStore,
} from "./testing/in-memory";

const { orgA, orgB, owner, otherUser } = ACTORS;

const FAILING_REPORTS: ReportRepository = {
  async findBySlug() {
    return err({ kind: "Unexpected", message: "db down" });
  },
  async findById() {
    return err({ kind: "Unexpected", message: "db down" });
  },
  async searchByOrg() {
    return err({ kind: "Unexpected", message: "db down" });
  },
  async hasReportsInFolder() {
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
  async listVersions() {
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
  async hasChildFolders() {
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

const writeDeps = (): WriteGrantCheckDeps => makeGrantCheckDeps();

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

describe("folder guards (ADR-0076)", () => {
  const F1 = "00000000-0000-7000-8000-0000000000f1";
  const actorMe: TenancyActor = { orgId: orgA, userId: owner };
  const actorOther: TenancyActor = { orgId: orgA, userId: otherUser };

  it("loadVisibleFolder returns a live, same-org, legacy folder for anyone", async () => {
    const folders = new InMemoryFolderRepository();
    await folders.save(folder(F1, orgA, "Docs"));
    const r = await loadVisibleFolder(folders, actorMe, folderId(F1), makeFolderAccessDeps());
    expect(r.ok && r.value.name).toBe("Docs");
  });

  it("loadVisibleFolder rejects an unknown folder id with NotFound (default message)", async () => {
    const folders = new InMemoryFolderRepository();
    const r = await loadVisibleFolder(
      folders,
      actorMe,
      folderId("00000000-0000-7000-8000-00000000dead"),
      makeFolderAccessDeps(),
    );
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "folder not found" });
  });

  it("loadVisibleFolder rejects a soft-deleted folder with NotFound", async () => {
    const folders = new InMemoryFolderRepository();
    await folders.save(folder(F1, orgA, "Docs"));
    await folders.softDelete(folderId(F1));
    const r = await loadVisibleFolder(folders, actorMe, folderId(F1), makeFolderAccessDeps());
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "folder not found" });
  });

  it("loadVisibleFolder rejects a cross-org folder with NotAllowed (default message)", async () => {
    const folders = new InMemoryFolderRepository();
    await folders.save(folder(F1, orgA, "Docs"));
    const r = await loadVisibleFolder(
      folders,
      { orgId: orgB, userId: owner },
      folderId(F1),
      makeFolderAccessDeps(),
    );
    expect(!r.ok && r.error).toEqual({ kind: "NotAllowed", message: "folder is not in your org" });
  });

  it("loadVisibleFolder hides another user's PRIVATE folder as NotFound — existence is private", async () => {
    const folders = new InMemoryFolderRepository();
    await folders.save(folder(F1, orgA, "Secret", { ownerId: otherUser, visibility: "private" }));
    const r = await loadVisibleFolder(folders, actorMe, folderId(F1), makeFolderAccessDeps());
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "folder not found" });
  });

  it("loadVisibleFolder admits a folder-share grantee (userId match)", async () => {
    const folders = new InMemoryFolderRepository();
    const deps = makeFolderAccessDeps();
    await folders.save(folder(F1, orgA, "Secret", { ownerId: otherUser, visibility: "private" }));
    await deps.folderShares.grant(folderId(F1), "me@test.local", otherUser, owner);
    const r = await loadVisibleFolder(folders, actorMe, folderId(F1), deps);
    expect(r.ok && r.value.name).toBe("Secret");
  });

  it("loadVisibleFolder admits a folder-share grantee by NORMALIZED EMAIL", async () => {
    const folders = new InMemoryFolderRepository();
    const deps = makeFolderAccessDeps();
    deps.identities.seedUser(owner, "Me@Test.Local");
    await folders.save(folder(F1, orgA, "Secret", { ownerId: otherUser, visibility: "private" }));
    await deps.folderShares.grant(folderId(F1), "me@test.local", otherUser, null);
    const r = await loadVisibleFolder(folders, actorMe, folderId(F1), deps);
    expect(r.ok && r.value.name).toBe("Secret");
  });

  it("loadVisibleFolder passes through a repo-error unchanged", async () => {
    const r = await loadVisibleFolder(
      FAILING_FOLDERS,
      actorMe,
      folderId(F1),
      makeFolderAccessDeps(),
    );
    expect(!r.ok && r.error).toEqual({ kind: "Unexpected", message: "db down" });
  });

  it("loadVisibleFolder honors caller-supplied messages (move-report's target text)", async () => {
    const folders = new InMemoryFolderRepository();
    const r = await loadVisibleFolder(folders, actorMe, folderId(F1), makeFolderAccessDeps(), {
      notFound: "target folder not found",
      notInOrg: "target folder is not in the report's org",
      notWritable: "unused",
    });
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "target folder not found" });
  });

  it("loadWritableFolder admits the OWNER of a private folder", async () => {
    const folders = new InMemoryFolderRepository();
    await folders.save(folder(F1, orgA, "Mine", { ownerId: owner, visibility: "private" }));
    const r = await loadWritableFolder(folders, actorMe, folderId(F1), makeFolderAccessDeps());
    expect(r.ok).toBe(true);
  });

  it("loadWritableFolder admits anyone for a legacy or org-visible folder", async () => {
    const folders = new InMemoryFolderRepository();
    await folders.save(folder(F1, orgA, "Legacy"));
    const legacy = await loadWritableFolder(
      folders,
      actorOther,
      folderId(F1),
      makeFolderAccessDeps(),
    );
    expect(legacy.ok).toBe(true);
    const F2 = "00000000-0000-7000-8000-0000000000f2";
    await folders.save(folder(F2, orgA, "Team", { ownerId: owner, visibility: "org" }));
    const orgVisible = await loadWritableFolder(
      folders,
      actorOther,
      folderId(F2),
      makeFolderAccessDeps(),
    );
    expect(orgVisible.ok).toBe(true);
  });

  it("loadWritableFolder denies a share-visible grantee with NotAllowed — visibility only", async () => {
    const folders = new InMemoryFolderRepository();
    const deps = makeFolderAccessDeps();
    await folders.save(folder(F1, orgA, "Secret", { ownerId: otherUser, visibility: "private" }));
    await deps.folderShares.grant(folderId(F1), "me@test.local", otherUser, owner);
    const r = await loadWritableFolder(folders, actorMe, folderId(F1), deps);
    expect(!r.ok && r.error).toEqual({
      kind: "NotAllowed",
      message: "you do not have write access to this folder",
    });
  });

  it("loadManagedFolder admits the owner and (adoption path) anyone on a legacy folder", async () => {
    const folders = new InMemoryFolderRepository();
    await folders.save(folder(F1, orgA, "Mine", { ownerId: owner, visibility: "private" }));
    const asOwner = await loadManagedFolder(folders, actorMe, folderId(F1), makeFolderAccessDeps());
    expect(asOwner.ok).toBe(true);
    const F2 = "00000000-0000-7000-8000-0000000000f2";
    await folders.save(folder(F2, orgA, "Legacy"));
    const asAnyone = await loadManagedFolder(
      folders,
      actorOther,
      folderId(F2),
      makeFolderAccessDeps(),
    );
    expect(asAnyone.ok).toBe(true);
  });

  it("loadManagedFolder denies a non-owner on an owned, org-visible folder with NotAllowed", async () => {
    const folders = new InMemoryFolderRepository();
    await folders.save(folder(F1, orgA, "Team", { ownerId: owner, visibility: "org" }));
    const r = await loadManagedFolder(folders, actorOther, folderId(F1), makeFolderAccessDeps());
    expect(!r.ok && r.error).toEqual({
      kind: "NotAllowed",
      message: "only the folder's owner can manage its sharing",
    });
  });

  it("loadManagedFolder hides an invisible private folder as NotFound", async () => {
    const folders = new InMemoryFolderRepository();
    await folders.save(folder(F1, orgA, "Secret", { ownerId: owner, visibility: "private" }));
    const r = await loadManagedFolder(folders, actorOther, folderId(F1), makeFolderAccessDeps());
    expect(!r.ok && r.error).toEqual({ kind: "NotFound", message: "folder not found" });
  });
});
