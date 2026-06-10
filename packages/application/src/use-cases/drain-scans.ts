// drainScans — the async scan worker's core orchestration (Phase 1.5a). Claim a
// batch of queued versions from the work queue, run each through the Scanner,
// apply the verdict via processScanResult (which promotes-if-newest-clean,
// ADR-0037 §8), and ack/retry on the queue. Pure orchestration over the driven
// ports (ADR-0024) — pg-boss, the advisory lock, and the HTTP trigger live in
// the adapter/route. Idempotent by construction: duplicate delivery re-runs
// processScanResult, whose completeScan guard + monotonic promote make it a
// no-op (the scan_jobs unique index + ne(status,'done') guard).
import { type AppError, ok, type Result } from "arp-domain";
import type { ScanJobMessage, Scanner, ScanWorkQueue } from "../ports";
import { type ProcessScanResultDeps, processScanResult } from "./process-scan-result";

export interface DrainScansDeps extends ProcessScanResultDeps {
  readonly scanWork: ScanWorkQueue;
  readonly scanner: Scanner;
}

export interface DrainScansCommand {
  /** Max jobs to claim this tick (bounded so a serverless invocation stays well under its limit). */
  readonly batchSize: number;
}

export interface DrainScansOutcome {
  readonly processed: number;
  readonly failed: number;
}

export async function drainScans(
  deps: DrainScansDeps,
  cmd: DrainScansCommand,
): Promise<Result<DrainScansOutcome, AppError>> {
  const batch = await deps.scanWork.fetch(cmd.batchSize);
  if (!batch.ok) return batch;

  let processed = 0;
  let failed = 0;
  for (const job of batch.value) {
    const outcome = await processOne(deps, job);
    if (outcome.ok) {
      await deps.scanWork.complete(job.jobId);
      processed += 1;
    } else {
      // Return the job to the queue; pg-boss retries it on a later tick. A single
      // bad job never aborts the rest of the batch.
      await deps.scanWork.fail(job.jobId, outcome.error.message);
      failed += 1;
    }
  }
  return ok({ processed, failed });
}

async function processOne(
  deps: DrainScansDeps,
  job: ScanJobMessage,
): Promise<Result<void, AppError>> {
  const running = await deps.scans.markRunning(job.versionId);
  if (!running.ok) return running;

  const verdict = await deps.scanner.scan({ reportId: job.reportId, versionId: job.versionId });
  if (!verdict.ok) return verdict;

  const result = await processScanResult(deps, {
    reportId: job.reportId,
    versionId: job.versionId,
    verdict: verdict.value,
  });
  if (!result.ok) return result;
  return ok(undefined);
}
