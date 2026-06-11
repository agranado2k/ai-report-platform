// DrizzleScanQueue — the scan_jobs side of the scan pipeline. Per
// docs/db-design.md "Phase 1 scan stub" + ADR-0037 §8: `enqueueScan` records a
// `queued` row on upload; `completeScan` drives it `queued → done` with the
// terminal verdict. Promotion of `live_version_id` itself lives in the
// processScanResult use case (application layer) — this adapter only owns the
// scan_jobs row. Phase 1 calls completeScan synchronously with `clean`;
// Phase 1.5's real scanner calls it with the actual verdict.
import type { ScanQueue, ScanRequest } from "arp-application";
import { reportVersions, scanJobs } from "arp-db/schema";
import {
  type AppError,
  ok,
  type ReportId,
  type Result,
  type TerminalScanStatus,
  type VersionId,
} from "arp-domain";
import { and, eq, ne } from "drizzle-orm";
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

  async listQueued(limit: number): Promise<Result<readonly ScanRequest[], AppError>> {
    try {
      // Join report_versions to recover the reportId the work queue needs
      // (scan_jobs only holds report_version_id). Indexed by scan_jobs_status_idx.
      const rows = await this.ctx
        .current()
        .select({ reportId: reportVersions.reportId, versionId: scanJobs.reportVersionId })
        .from(scanJobs)
        .innerJoin(reportVersions, eq(reportVersions.id, scanJobs.reportVersionId))
        .where(eq(scanJobs.status, "queued"))
        .limit(limit);
      return ok(
        rows.map((r) => ({
          reportId: r.reportId as ReportId,
          versionId: r.versionId as VersionId,
        })),
      );
    } catch (e) {
      return {
        ok: false,
        error: {
          kind: "Unexpected",
          message: `scan.listQueued: ${e instanceof Error ? e.message : String(e)}`,
        },
      };
    }
  }

  async markRunning(versionId: VersionId): Promise<Result<void, AppError>> {
    try {
      // Best-effort `queued → running` when the worker claims the job. Guarded
      // `status = 'queued'` so a duplicate delivery (job already running/done) is
      // a no-op, not a backwards transition.
      await this.ctx
        .current()
        .update(scanJobs)
        .set({ status: "running", startedAt: new Date() })
        .where(and(eq(scanJobs.reportVersionId, versionId), eq(scanJobs.status, "queued")));
      return ok(undefined);
    } catch (e) {
      return {
        ok: false,
        error: {
          kind: "Unexpected",
          message: `scan.markRunning: ${e instanceof Error ? e.message : String(e)}`,
        },
      };
    }
  }

  async completeScan(
    versionId: VersionId,
    verdict: TerminalScanStatus,
  ): Promise<Result<void, AppError>> {
    try {
      // Guard `status != 'done'` so re-completing an already-terminal job is a
      // no-op rather than clobbering its verdict — matters once the real scanner
      // (Phase 1.5) runs async and a duplicate event could race. The async worker
      // drives queued → running → done (markRunning above, then this).
      await this.ctx
        .current()
        .update(scanJobs)
        .set({ status: "done", verdict, finishedAt: new Date() })
        .where(and(eq(scanJobs.reportVersionId, versionId), ne(scanJobs.status, "done")));
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
