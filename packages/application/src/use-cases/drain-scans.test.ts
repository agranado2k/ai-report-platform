import {
  type AppError,
  createReport,
  err,
  folderId,
  makeSlug,
  ok,
  orgId,
  type Result,
  reportId,
  type TerminalScanStatus,
  userId,
  versionId,
} from "arp-domain";
import { describe, expect, it } from "vitest";
import type { Scanner } from "../ports";
import {
  InMemoryEventOutbox,
  InMemoryReportRepository,
  InMemoryScanWorkQueue,
  PassThroughUnitOfWork,
  RecordingScanQueue,
} from "../testing/in-memory";
import { type DrainScansDeps, drainScans } from "./drain-scans";

const RID = reportId("00000000-0000-4000-8000-0000000000a1");
const VID = versionId("00000000-0000-4000-8000-0000000000b1");

const scannerReturning = (verdict: TerminalScanStatus): Scanner => ({
  async scan(): Promise<Result<TerminalScanStatus, AppError>> {
    return ok(verdict);
  },
});

const failingScanner: Scanner = {
  async scan(): Promise<Result<TerminalScanStatus, AppError>> {
    return err({ kind: "Unexpected", message: "scanner exploded" });
  },
};

function deps(scanner: Scanner) {
  return {
    reports: new InMemoryReportRepository(),
    scans: new RecordingScanQueue(),
    outbox: new InMemoryEventOutbox(),
    uow: new PassThroughUnitOfWork(),
    scanWork: new InMemoryScanWorkQueue(),
    scanner,
  } satisfies DrainScansDeps;
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

describe("drainScans", () => {
  it("processes a queued job: marks running, scans clean, promotes, completes the job", async () => {
    const d = deps(scannerReturning("clean"));
    await seedPendingReport(d.reports);
    await d.scanWork.publish(RID, VID);

    const r = await drainScans(d, { batchSize: 10 });

    expect(r.ok && r.value).toEqual({ processed: 1, failed: 0 });
    expect(d.scans.running).toEqual([VID]);
    expect(d.scans.completed).toEqual([{ versionId: VID, verdict: "clean" }]);
    expect(d.scanWork.completedJobs).toEqual(["job-1"]);
    expect(d.scanWork.failedJobs).toEqual([]);
    const saved = await d.reports.findById(RID);
    expect(saved.ok && saved.value?.liveVersionId).toBe(VID);
    expect(d.outbox.drained().filter((e) => e.type === "ReportPublished")).toHaveLength(1);
  });

  it("does nothing when the queue is empty", async () => {
    const d = deps(scannerReturning("clean"));

    const r = await drainScans(d, { batchSize: 10 });

    expect(r.ok && r.value).toEqual({ processed: 0, failed: 0 });
    expect(d.scanWork.completedJobs).toEqual([]);
  });

  it("fails a job (returned to the queue) when the scanner errors — does not promote", async () => {
    const d = deps(failingScanner);
    await seedPendingReport(d.reports);
    await d.scanWork.publish(RID, VID);

    const r = await drainScans(d, { batchSize: 10 });

    expect(r.ok && r.value).toEqual({ processed: 0, failed: 1 });
    expect(d.scanWork.failedJobs).toEqual([{ jobId: "job-1", reason: "scanner exploded" }]);
    expect(d.scanWork.completedJobs).toEqual([]);
    expect(d.scans.completed).toEqual([]);
    const saved = await d.reports.findById(RID);
    expect(saved.ok && saved.value?.liveVersionId).toBe(null);
  });

  it("is idempotent under duplicate delivery: re-processing the same version promotes only once", async () => {
    const d = deps(scannerReturning("clean"));
    await seedPendingReport(d.reports);
    await d.scanWork.publish(RID, VID);
    await d.scanWork.publish(RID, VID); // same version delivered twice

    const r = await drainScans(d, { batchSize: 10 });

    expect(r.ok && r.value).toEqual({ processed: 2, failed: 0 });
    // Monotonic promote-if-newer (ADR-0037 §8): the second pass is a no-op promote.
    expect(d.outbox.drained().filter((e) => e.type === "ReportPublished")).toHaveLength(1);
  });
});
