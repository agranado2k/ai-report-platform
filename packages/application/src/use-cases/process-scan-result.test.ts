import { createReport, folderId, makeSlug, orgId, reportId, userId, versionId } from "arp-domain";
import { describe, expect, it } from "vitest";
import {
  InMemoryEventOutbox,
  InMemoryReportRepository,
  PassThroughUnitOfWork,
  RecordingScanQueue,
} from "../testing/in-memory";
import { type ProcessScanResultDeps, processScanResult } from "./process-scan-result";

const RID = reportId("00000000-0000-4000-8000-0000000000a1");
const VID = versionId("00000000-0000-4000-8000-0000000000b1");

function deps() {
  return {
    reports: new InMemoryReportRepository(),
    scans: new RecordingScanQueue(),
    outbox: new InMemoryEventOutbox(),
    uow: new PassThroughUnitOfWork(),
  } satisfies ProcessScanResultDeps;
}

async function seedPendingReport(reports: InMemoryReportRepository) {
  const slug = makeSlug("abcde12345");
  if (!slug.ok) throw new Error("test slug invalid");
  const { report } = createReport({
    id: RID,
    orgId: orgId("00000000-0000-4000-8000-000000000001"),
    folderId: folderId("00000000-0000-4000-8000-000000000003"),
    slug: slug.value,
    title: "Report",
    versionId: VID,
    contentHash: "a".repeat(64),
    uploadedBy: userId("00000000-0000-4000-8000-000000000002"),
    manifest: { entryDocument: "index.html", files: ["index.html"] },
    sizeBytes: 11,
  });
  await reports.save(report);
}

describe("processScanResult", () => {
  it("on a clean verdict: caches scan_status=clean, promotes to live, emits ReportPublished, completes the job", async () => {
    const d = deps();
    await seedPendingReport(d.reports);

    const r = await processScanResult(d, { reportId: RID, versionId: VID, verdict: "clean" });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.scanStatus).toBe("clean");
      expect(r.value.promoted).toBe(true);
    }
    const saved = await d.reports.findById(RID);
    expect(saved.ok && saved.value?.liveVersionId).toBe(VID);
    expect(saved.ok && saved.value?.versions[0]?.scanStatus).toBe("clean");
    expect(d.outbox.drained().some((e) => e.type === "ReportPublished")).toBe(true);
    expect(d.scans.completed).toEqual([{ versionId: VID, verdict: "clean" }]);
  });

  it("on a flagged verdict: caches scan_status=flagged, does NOT promote, completes the job", async () => {
    const d = deps();
    await seedPendingReport(d.reports);

    const r = await processScanResult(d, { reportId: RID, versionId: VID, verdict: "flagged" });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.promoted).toBe(false);
    const saved = await d.reports.findById(RID);
    expect(saved.ok && saved.value?.liveVersionId).toBe(null);
    expect(saved.ok && saved.value?.versions[0]?.scanStatus).toBe("flagged");
    expect(d.outbox.drained().some((e) => e.type === "ReportPublished")).toBe(false);
    expect(d.scans.completed).toEqual([{ versionId: VID, verdict: "flagged" }]);
  });

  it("returns NotFound when the report does not exist", async () => {
    const d = deps();
    const r = await processScanResult(d, { reportId: RID, versionId: VID, verdict: "clean" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("NotFound");
  });
});
