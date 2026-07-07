import { describe, expect, it } from "vitest";
import { folderId, orgId, reportId, userId, versionId } from "./brand";
import { addVersion, applyScanResult, createReport, type Report, renameReport } from "./report";
import { makeSlug, type Slug } from "./slug";

const slug = (): Slug => {
  const r = makeSlug("abc1234567");
  if (!r.ok) throw new Error("test slug invalid");
  return r.value;
};

const newReport = (): Report => {
  const { report } = createReport({
    id: reportId("r1"),
    orgId: orgId("o1"),
    folderId: folderId("f1"),
    slug: slug(),
    title: "Q3 metrics",
    versionId: versionId("v1"),
    contentHash: "hash-1",
    uploadedBy: userId("u1"),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 11,
  });
  return report;
};

describe("createReport", () => {
  it("creates version 1 as pending with no live version", () => {
    const { report, events } = createReport({
      id: reportId("r1"),
      orgId: orgId("o1"),
      folderId: folderId("f1"),
      slug: slug(),
      title: "Q3 metrics",
      versionId: versionId("v1"),
      contentHash: "hash-1",
      uploadedBy: userId("u1"),
      manifest: { entryDocument: "index.html", files: ["index.html"] },
      sizeBytes: 11,
    });
    expect(report.versions).toHaveLength(1);
    expect(report.versions[0]?.versionNo).toBe(1);
    expect(report.versions[0]?.scanStatus).toBe("pending");
    expect(report.liveVersionId).toBeNull();
    expect(events).toEqual([
      {
        type: "ReportVersionUploaded",
        reportId: "r1",
        versionId: "v1",
        versionNo: 1,
        origin: "upload",
      },
    ]);
  });

  it("records the version manifest + size on the created version", () => {
    const v = newReport().versions[0];
    expect(v?.manifest).toEqual({ entryDocument: "index.html", files: ["index.html"] });
    expect(v?.sizeBytes).toBe(11);
  });

  it("sets the creator as the owner (ADR-0059)", () => {
    expect(newReport().ownerId).toBe(userId("u1"));
  });

  it("defaults the first version's origin to 'upload' when omitted (ADR-0065)", () => {
    expect(newReport().versions[0]?.origin).toBe("upload");
  });

  it("honors an explicit origin on create, and stamps it on the ReportVersionUploaded event", () => {
    const { report, events } = createReport({
      id: reportId("r1"),
      orgId: orgId("o1"),
      folderId: folderId("f1"),
      slug: slug(),
      title: "Q3 metrics",
      versionId: versionId("v1"),
      contentHash: "hash-1",
      uploadedBy: userId("u1"),
      manifest: { entryDocument: "index.html", files: ["index.html"] },
      sizeBytes: 11,
      origin: "editor",
    });
    expect(report.versions[0]?.origin).toBe("editor");
    expect(events[0]?.type === "ReportVersionUploaded" && events[0]?.origin).toBe("editor");
  });
});

describe("addVersion", () => {
  it("appends version 2 (pending) without changing the live version", () => {
    const r = applyScanResult(newReport(), versionId("v1"), "clean").report; // v1 live
    const result = addVersion(r, {
      versionId: versionId("v2"),
      contentHash: "hash-2",
      uploadedBy: userId("u1"),
      manifest: { entryDocument: "index.html", files: ["index.html"] },
      sizeBytes: 11,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.report.versions).toHaveLength(2);
      expect(result.value.report.versions[1]?.versionNo).toBe(2);
      expect(result.value.report.versions[1]?.scanStatus).toBe("pending");
      expect(result.value.report.liveVersionId).toBe("v1"); // unchanged until v2 scans clean
      expect(result.value.events[0]?.type).toBe("ReportVersionUploaded");
      expect(result.value.report.versions[1]?.origin).toBe("upload"); // default (ADR-0065)
    }
  });

  it("rejects re-upload of a taken-down report", () => {
    const taken: Report = { ...newReport(), deletedAt: 1 };
    const result = addVersion(taken, {
      versionId: versionId("v2"),
      contentHash: "h",
      uploadedBy: userId("u1"),
      manifest: { entryDocument: "index.html", files: ["index.html"] },
      sizeBytes: 11,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NotFound");
  });
});

describe("applyScanResult — promotion (ADR-0037 §8)", () => {
  it("promotes the first clean version to live and emits ReportPublished(firstPublish)", () => {
    const { report, events } = applyScanResult(newReport(), versionId("v1"), "clean");
    expect(report.liveVersionId).toBe("v1");
    expect(report.versions[0]?.scanStatus).toBe("clean");
    expect(events).toEqual([
      { type: "ReportPublished", reportId: "r1", versionId: "v1", firstPublish: true },
    ]);
  });

  it("does not promote a flagged or blocked version", () => {
    for (const verdict of ["flagged", "blocked"] as const) {
      const { report, events } = applyScanResult(newReport(), versionId("v1"), verdict);
      expect(report.liveVersionId).toBeNull();
      expect(report.versions[0]?.scanStatus).toBe(verdict);
      expect(events).toEqual([]);
    }
  });

  it("promotes a newer clean version over the current live one", () => {
    const r = applyScanResult(newReport(), versionId("v1"), "clean").report; // v1 live
    const added = addVersion(r, {
      versionId: versionId("v2"),
      contentHash: "h2",
      uploadedBy: userId("u1"),
      manifest: { entryDocument: "index.html", files: ["index.html"] },
      sizeBytes: 11,
    });
    if (!added.ok) throw new Error("addVersion failed");
    const { report, events } = applyScanResult(added.value.report, versionId("v2"), "clean");
    expect(report.liveVersionId).toBe("v2");
    expect(events).toEqual([
      { type: "ReportPublished", reportId: "r1", versionId: "v2", firstPublish: false },
    ]);
  });

  it("silently absorbs a scan result for an unknown version (idempotent stale-event)", () => {
    const { report, events } = applyScanResult(newReport(), versionId("does-not-exist"), "clean");
    expect(report.liveVersionId).toBeNull();
    expect(report.versions).toHaveLength(1);
    expect(report.versions[0]?.scanStatus).toBe("pending");
    expect(events).toEqual([]);
  });

  it("never demotes: an out-of-order clean for an older version is ignored", () => {
    // v1 and v2 exist; v2 is live. A late clean verdict for v1 must not demote.
    let r = applyScanResult(newReport(), versionId("v1"), "clean").report;
    const added = addVersion(r, {
      versionId: versionId("v2"),
      contentHash: "h2",
      uploadedBy: userId("u1"),
      manifest: { entryDocument: "index.html", files: ["index.html"] },
      sizeBytes: 11,
    });
    if (!added.ok) throw new Error("addVersion failed");
    r = applyScanResult(added.value.report, versionId("v2"), "clean").report; // v2 live
    const { report, events } = applyScanResult(r, versionId("v1"), "clean");
    expect(report.liveVersionId).toBe("v2");
    expect(events).toEqual([]);
  });
});

describe("renameReport", () => {
  it("updates the title (trimmed) and leaves the slug unchanged", () => {
    const report = newReport();
    const r = renameReport(report, "  New Title  ");
    expect(r.ok && r.value.title).toBe("New Title");
    expect(r.ok && r.value.slug).toBe(report.slug);
  });

  it("rejects an empty title with a ValidationError", () => {
    const r = renameReport(newReport(), "   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ValidationError");
  });
});
