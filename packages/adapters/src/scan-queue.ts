// DrizzleScanQueue — Phase-1 scan stub. Per docs/db-design.md "Phase 1 scan
// stub" + ADR-0037 §8, the Phase-1 stub is meant to drive the job queued→done
// with verdict='clean' and emit ReportVersionScanned(clean), promoting
// live_version_id; only the REAL scanner lands in Phase 1.5.
//
// KNOWN GAP (flagged on PR #29): this enqueue only records a `queued` row and
// never completes the job, so live_version_id stays null and the viewer falls
// back to serving the latest version directly. Wiring the promoting stub + the
// ADR-0038 viewer state machine is tracked as a follow-up.
import type { ScanQueue } from "arp-application";
import { scanJobs } from "arp-db/schema";
import { type AppError, ok, type ReportId, type Result, type VersionId } from "arp-domain";
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
}
