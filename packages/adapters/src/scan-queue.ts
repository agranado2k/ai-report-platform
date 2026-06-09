// DrizzleScanQueue — Phase-1 scan stub (ADR-0015 / memory: always-clean until
// 1.5). Enqueuing records a `scan_jobs` row (queued); the real scanner + the
// async promotion to `live` land in Phase 1.5. The Phase-1 viewer serves the
// latest version regardless, so an upload is viewable immediately.
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
