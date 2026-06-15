// Integration tests for DrizzleScanQueue (the scan_jobs work list) against real
// Postgres (pglite). The pg-boss-backed ScanWorkQueue is exercised by the e2e
// tier against Neon, not here.
import { scanJobs } from "arp-db/schema";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrizzleReportRepository } from "./report-repository";
import { DrizzleScanQueue } from "./scan-queue";
import {
  makeTestDb,
  SAMPLE_REPORT_ID,
  SAMPLE_VERSION_ID,
  sampleReport,
  seedIdentity,
  type TestDb,
} from "./testing/pglite";

describe("DrizzleScanQueue (pglite integration)", () => {
  let tdb: TestDb;
  let queue: DrizzleScanQueue;

  beforeEach(async () => {
    tdb = await makeTestDb();
    await seedIdentity(tdb.ctx);
    // A scan_job references a report_version, so the report must exist first.
    await new DrizzleReportRepository(tdb.ctx).save(sampleReport().report);
    queue = new DrizzleScanQueue(tdb.ctx);
  });
  afterEach(() => tdb.close());

  it("enqueues a queued job that listQueued returns with its reportId recovered", async () => {
    expect((await queue.enqueueScan(SAMPLE_REPORT_ID, SAMPLE_VERSION_ID)).ok).toBe(true);

    const q = await queue.listQueued(10);
    expect(q.ok).toBe(true);
    if (q.ok) {
      expect(q.value).toHaveLength(1);
      expect(q.value[0]).toEqual({ reportId: SAMPLE_REPORT_ID, versionId: SAMPLE_VERSION_ID });
    }
  });

  it("markRunning takes the job out of the queued list", async () => {
    await queue.enqueueScan(SAMPLE_REPORT_ID, SAMPLE_VERSION_ID);
    expect((await queue.markRunning(SAMPLE_VERSION_ID)).ok).toBe(true);

    const q = await queue.listQueued(10);
    expect(q.ok && q.value).toHaveLength(0);
  });

  it("completeScan drives the job to done with the terminal verdict", async () => {
    await queue.enqueueScan(SAMPLE_REPORT_ID, SAMPLE_VERSION_ID);
    expect((await queue.completeScan(SAMPLE_VERSION_ID, "clean")).ok).toBe(true);

    const [row] = await tdb.ctx
      .current()
      .select()
      .from(scanJobs)
      .where(eq(scanJobs.reportVersionId, SAMPLE_VERSION_ID));
    expect(row?.status).toBe("done");
    expect(row?.verdict).toBe("clean");
  });
});
