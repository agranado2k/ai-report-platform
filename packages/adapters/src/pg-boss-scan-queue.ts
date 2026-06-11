// PgBossScanWorkQueue — the ScanWorkQueue port backed by pg-boss (ADR-0045).
// Pure delivery: publish a version for scanning, claim a batch, ack/retry. The
// domain scan_jobs row (DrizzleScanQueue) remains the source of truth for the
// viewer's cached scan_status; this is just the transport. pg-boss types are
// confined here — the application sees only the ScanWorkQueue port (ADR-0024).
import type { ScanJobMessage, ScanWorkQueue } from "arp-application";
import { type AppError, ok, type ReportId, type Result, type VersionId } from "arp-domain";
import type { PgBoss } from "pg-boss";
import { SCAN_QUEUE } from "./pg-boss";

interface ScanJobData {
  readonly reportId: string;
  readonly versionId: string;
}

function unexpected(op: string, e: unknown): Result<never, AppError> {
  return {
    ok: false,
    error: { kind: "Unexpected", message: `${op}: ${e instanceof Error ? e.message : String(e)}` },
  };
}

export class PgBossScanWorkQueue implements ScanWorkQueue {
  constructor(private readonly boss: PgBoss) {}

  async publish(reportId: ReportId, versionId: VersionId): Promise<Result<void, AppError>> {
    try {
      // singletonKey = versionId dedupes: the drain re-publishes still-`queued`
      // rows every tick, so without this an unprocessed version would accumulate
      // a duplicate pg-boss job per tick. With it, at most one live job exists
      // per version (processing stays idempotent regardless).
      await this.boss.send(SCAN_QUEUE, { reportId, versionId } satisfies ScanJobData, {
        singletonKey: versionId,
      });
      return ok(undefined);
    } catch (e) {
      return unexpected("scanWork.publish", e);
    }
  }

  async fetch(batchSize: number): Promise<Result<readonly ScanJobMessage[], AppError>> {
    try {
      const jobs = await this.boss.fetch<ScanJobData>(SCAN_QUEUE, { batchSize });
      return ok(
        jobs.map((j) => ({
          reportId: j.data.reportId as ReportId,
          versionId: j.data.versionId as VersionId,
          jobId: j.id,
        })),
      );
    } catch (e) {
      return unexpected("scanWork.fetch", e);
    }
  }

  async complete(jobId: string): Promise<Result<void, AppError>> {
    try {
      await this.boss.complete(SCAN_QUEUE, jobId);
      return ok(undefined);
    } catch (e) {
      return unexpected("scanWork.complete", e);
    }
  }

  async fail(jobId: string, reason: string): Promise<Result<void, AppError>> {
    try {
      await this.boss.fail(SCAN_QUEUE, jobId, { reason });
      return ok(undefined);
    } catch (e) {
      return unexpected("scanWork.fail", e);
    }
  }
}
