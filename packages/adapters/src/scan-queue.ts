// DrizzleScanQueue — the scan_jobs side of the scan pipeline. Per
// docs/db-design.md "Phase 1 scan stub" + ADR-0037 §8: `enqueueScan` records a
// `queued` row on upload; `completeScan` drives it `queued → done` with the
// terminal verdict. Promotion of `live_version_id` itself lives in the
// processScanResult use case (application layer) — this adapter only owns the
// scan_jobs row. Phase 1 calls completeScan synchronously with `clean`;
// Phase 1.5's real scanner calls it with the actual verdict.
import type { ScanQueue } from "arp-application";
import { scanJobs } from "arp-db/schema";
import {
  type AppError,
  ok,
  type ReportId,
  type Result,
  type TerminalScanStatus,
  type VersionId,
} from "arp-domain";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { DbContext } from "./client";

export class DrizzleScanQueue implements ScanQueue {
  constructor(private readonly ctx: DbContext) {}

  async enqueueScan(_reportId: ReportId, versionId: VersionId): Promise<Result<void, AppError>> {
    try {
      await this.ctx
        .current()
        .insert(scanJobs)
        .values({ id: uuidv7(), reportVersionId: versionId, status: "queued" })
        .onConflictDoNothing();
      return ok(undefined);
    } catch (e) {
      return {
        ok: false,
        error: {
          kind: "Unexpected",
          message: `scan.enqueue: ${e instanceof Error ? e.message : String(e)}`,
        },
      };
    }
  }

  async completeScan(
    versionId: VersionId,
    verdict: TerminalScanStatus,
  ): Promise<Result<void, AppError>> {
    try {
      await this.ctx
        .current()
        .update(scanJobs)
        .set({ status: "done", verdict, finishedAt: new Date() })
        .where(eq(scanJobs.reportVersionId, versionId));
      return ok(undefined);
    } catch (e) {
      return {
        ok: false,
        error: {
          kind: "Unexpected",
          message: `scan.complete: ${e instanceof Error ? e.message : String(e)}`,
        },
      };
    }
  }
}
